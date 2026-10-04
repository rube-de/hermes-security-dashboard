import { json } from '@sveltejs/kit';
import { getRepoDetail } from '$lib/server/repos';
import { insertReview, type FindingInput } from '$lib/server/ingest';
import { setNextRun } from '$lib/server/meta';
import { checkWriteAuth } from '$lib/server/auth';
import { intField, parseTimeValue, readJsonObject, stringField } from '$lib/server/params';
import type { Severity } from '$lib/types';
import type { RequestHandler } from './$types';

const VALID_SEV = new Set<Severity>(['crit', 'high', 'med', 'low']);
/** Max length of the agent contract strings (`ruleId`, `locationKey`, `agentVersion`). */
const AGENT_FIELD_MAX = 200;

export const GET: RequestHandler = ({ params }) => {
	const repo = getRepoDetail(params.id);
	if (!repo) return json({ error: 'repository not found' }, { status: 404 });
	return json(repo.reviews);
};

/**
 * Submit a security review report for a repository. The Hermes agent posts:
 *   {
 *     commit, model?, trigger?, engine?, summary?, durationSecs?, lines?, filesScanned?,
 *     agentVersion?,
 *     findings: [{ severity, title, file?, line?, cwe?, description?, code?, recommendation?,
 *                  ruleId?, locationKey? }],
 *     html?,       // optional pre-rendered body; sanitized server-side before storage
 *     nextRunAt?   // when the agent plans its next run (epoch-ms or ISO-8601); drives "Next run"
 *   }
 * A commit can be scanned more than once (non-deterministic LLM re-runs, different
 * models), so submits are idempotent on scan *content* — commit + model + engine +
 * finding set — not on (repo, commit): a byte-equivalent resubmit returns the
 * existing review, anything else is a new one. Stored newCount counts repository-first
 * issue discoveries (including on re-scans); resolvedCount is a first-scan snapshot
 * against the previous commit's union. For commit-to-commit transitions use
 * GET /api/repos/:id: its commits groups compare complete, triage-aware unions.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const denied = checkWriteAuth(request);
	if (denied) return denied;

	if (!getRepoDetail(params.id)) {
		return json({ error: `repository "${params.id}" not found — register it first` }, { status: 404 });
	}

	const parsed = await readJsonObject(request);
	if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
	const body = parsed.value;

	const commit = typeof body.commit === 'string' ? body.commit.trim() : '';
	if (!commit) return json({ error: '`commit` (string) is required' }, { status: 400 });

	// Planned next run is the agent's schedule, independent of this review's content —
	// persist it whenever supplied, including on an idempotent re-submit below.
	let nextRunAt: number | null = null;
	if (body.nextRunAt !== undefined && body.nextRunAt !== null && body.nextRunAt !== '') {
		const t = parseTimeValue(body.nextRunAt, '`nextRunAt`');
		if (!t.ok) return json({ error: t.error }, { status: 400 });
		nextRunAt = t.value;
	}

	const numeric: Partial<Record<'durationSecs' | 'lines' | 'filesScanned', number>> = {};
	for (const k of ['durationSecs', 'lines', 'filesScanned'] as const) {
		const n = intField(body[k], `\`${k}\``);
		if (!n.ok) return json({ error: n.error }, { status: 400 });
		numeric[k] = n.value;
	}
	const agentVersion = stringField(body.agentVersion, '`agentVersion`', AGENT_FIELD_MAX);
	if (!agentVersion.ok) return json({ error: agentVersion.error }, { status: 400 });

	// A non-array `findings` would otherwise read as "no findings" and mark the repo clean.
	if (body.findings !== undefined && body.findings !== null && !Array.isArray(body.findings)) {
		return json({ error: '`findings` must be an array' }, { status: 400 });
	}
	const rawFindings: unknown[] = Array.isArray(body.findings) ? body.findings : [];
	const findings: FindingInput[] = [];
	for (let i = 0; i < rawFindings.length; i++) {
		const item = rawFindings[i];
		if (typeof item !== 'object' || item === null)
			return json({ error: `findings[${i}] must be an object` }, { status: 400 });
		// Non-null object out of JSON.parse: string keys only.
		const f = item as Record<string, unknown>;
		if (!VALID_SEV.has(f.severity as Severity))
			return json(
				{ error: `findings[${i}].severity must be one of crit|high|med|low` },
				{ status: 400 }
			);
		if (typeof f.title !== 'string' || !f.title.trim())
			return json({ error: `findings[${i}].title (string) is required` }, { status: 400 });
		const line = intField(f.line, `findings[${i}].line`);
		if (!line.ok) return json({ error: line.error }, { status: 400 });
		const ruleId = stringField(f.ruleId, `findings[${i}].ruleId`, AGENT_FIELD_MAX);
		if (!ruleId.ok) return json({ error: ruleId.error }, { status: 400 });
		const locationKey = stringField(f.locationKey, `findings[${i}].locationKey`, AGENT_FIELD_MAX);
		if (!locationKey.ok) return json({ error: locationKey.error }, { status: 400 });
		findings.push({
			severity: f.severity as Severity,
			title: f.title.trim(),
			file: typeof f.file === 'string' ? f.file : '',
			line: line.value ?? 0,
			cwe: typeof f.cwe === 'string' ? f.cwe : '',
			description: typeof f.description === 'string' ? f.description : '',
			code: typeof f.code === 'string' ? f.code : '',
			recommendation: typeof f.recommendation === 'string' ? f.recommendation : '',
			ruleId: ruleId.value,
			locationKey: locationKey.value
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
			...numeric,
			agentVersion: agentVersion.value,
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
