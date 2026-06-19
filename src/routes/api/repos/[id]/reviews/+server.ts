import { json } from '@sveltejs/kit';
import { getRepoDetail, insertReview, setNextRun, type FindingInput } from '$lib/server/store';
import { checkWriteAuth } from '$lib/server/auth';
import { parseTimeValue } from '$lib/server/params';
import type { Severity } from '$lib/types';
import type { RequestHandler } from './$types';

const VALID_SEV = new Set<Severity>(['crit', 'high', 'med', 'low']);

export const GET: RequestHandler = ({ params }) => {
	const repo = getRepoDetail(params.id);
	if (!repo) return json({ error: 'repository not found' }, { status: 404 });
	return json(repo.reviews);
};

/**
 * Submit a security review report for a repository. The Hermes agent posts:
 *   {
 *     commit, model?, trigger?, engine?, summary?, durationSecs?, lines?, filesScanned?,
 *     findings: [{ severity, title, file?, line?, cwe?, description?, code?, recommendation? }],
 *     html?,       // optional pre-rendered body; sanitized server-side before storage
 *     nextRunAt?   // when the agent plans its next run (epoch-ms or ISO-8601); drives "Next run"
 *   }
 * A commit can be scanned more than once (non-deterministic LLM re-runs, different
 * models), so submits are idempotent on scan *content* — commit + model + engine +
 * finding set — not on (repo, commit): a byte-equivalent resubmit returns the
 * existing review, anything else is a new one. The diff (new / carried / resolved)
 * is a property of the commit: only a commit's first scan carries a delta (against
 * the previous commit's union of findings); re-scans of the same commit report none.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const denied = checkWriteAuth(request);
	if (denied) return denied;

	if (!getRepoDetail(params.id)) {
		return json({ error: `repository "${params.id}" not found — register it first` }, { status: 404 });
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}

	const commit = typeof body.commit === 'string' ? body.commit.trim() : '';
	if (!commit) return json({ error: '`commit` (string) is required' }, { status: 400 });

	// Planned next run is the agent's schedule, independent of this review's content —
	// persist it whenever supplied, including on an idempotent re-submit below.
	let nextRunAt: number | null = null;
	if (body.nextRunAt !== undefined && body.nextRunAt !== null && body.nextRunAt !== '') {
		nextRunAt = parseTimeValue(body.nextRunAt);
		if (nextRunAt === null) {
			return json(
				{ error: '`nextRunAt` must be an epoch-ms number or ISO-8601 date' },
				{ status: 400 }
			);
		}
	}

	const rawFindings = Array.isArray(body.findings) ? body.findings : [];
	const findings: FindingInput[] = [];
	for (let i = 0; i < rawFindings.length; i++) {
		const f = rawFindings[i] as Record<string, unknown>;
		if (!f || typeof f !== 'object')
			return json({ error: `findings[${i}] must be an object` }, { status: 400 });
		if (!VALID_SEV.has(f.severity as Severity))
			return json(
				{ error: `findings[${i}].severity must be one of crit|high|med|low` },
				{ status: 400 }
			);
		if (typeof f.title !== 'string' || !f.title.trim())
			return json({ error: `findings[${i}].title (string) is required` }, { status: 400 });
		findings.push({
			severity: f.severity as Severity,
			title: f.title.trim(),
			file: typeof f.file === 'string' ? f.file : '',
			line: typeof f.line === 'number' ? f.line : 0,
			cwe: typeof f.cwe === 'string' ? f.cwe : '',
			description: typeof f.description === 'string' ? f.description : '',
			code: typeof f.code === 'string' ? f.code : '',
			recommendation: typeof f.recommendation === 'string' ? f.recommendation : ''
		});
	}

	try {
		const { id: reviewId, duplicate } = insertReview(params.id, {
			commit,
			model: typeof body.model === 'string' ? body.model.trim() : undefined,
			trigger: typeof body.trigger === 'string' ? body.trigger : undefined,
			// Trimmed like commit/model: engine is part of the dedup identity, so a
			// retry differing only in surrounding whitespace must still dedup.
			engine: typeof body.engine === 'string' ? body.engine.trim() : undefined,
			summary: typeof body.summary === 'string' ? body.summary : undefined,
			html: typeof body.html === 'string' ? body.html : undefined,
			durationSecs: typeof body.durationSecs === 'number' ? body.durationSecs : undefined,
			lines: typeof body.lines === 'number' ? body.lines : undefined,
			filesScanned: typeof body.filesScanned === 'number' ? body.filesScanned : undefined,
			findings
		});
		// Schedule reporting is independent of review idempotency — persist nextRunAt
		// on a deduped retry too.
		if (nextRunAt !== null) setNextRun(nextRunAt);
		if (duplicate) {
			return json({ ok: true, reviewId, repoId: params.id, duplicate: true }, { status: 200 });
		}
		return json({ ok: true, reviewId, repoId: params.id, findings: findings.length }, { status: 201 });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
