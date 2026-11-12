import { createHash } from 'node:crypto';
import { issueIdentity, SEVERITY_ORDER, type IdentityFields } from './fingerprint';

/**
 * Content identity of a scan submission: the commit it ran against, the model and
 * engine that produced it, and the set of issues it surfaced.
 *
 * Two submissions with the same content hash are the *same scan result* — i.e. an
 * at-least-once delivery retry — and the review POST dedups them. Any meaningful
 * change yields a new hash and therefore a new review:
 *   - an extra/removed issue (a non-deterministic LLM re-run finding more or less)
 *   - a different `model` (two models scanning the same commit)
 *   - a severity change for an existing issue
 *
 * Volatile, derived fields (duration, summary prose, html body, timestamps, agent
 * version) are excluded. Legacy hashes also ignore occurrence line/source text.
 * Continuity-aware submissions retain all accepted raw finding evidence, so changed
 * source reports cannot silently resolve to an older, differently worded report.
 */
export interface ScanIdentity {
	commit: string;
	model: string;
	engine: string;
	findings: (IdentityFields & {
		severity: string;
		line?: number | null;
		cwe?: string;
		description?: string;
		code?: string;
		recommendation?: string;
		issueId?: string;
		continuityEvidence?: string;
		noveltyReason?: string;
	})[];
}

/** Exact accepted finding evidence, shared by continuity dedup validation and hashing. */
export function reportedFindingKey(f: ScanIdentity['findings'][number]): string {
	return JSON.stringify([
		f.severity,
		f.title,
		f.file ?? '',
		f.line ?? 0,
		f.ruleId ?? '',
		f.locationKey ?? '',
		f.cwe ?? '',
		f.description ?? '',
		f.code ?? '',
		f.recommendation ?? '',
		f.issueId ?? '',
		f.continuityEvidence ?? '',
		f.noveltyReason ?? ''
	]);
}

export function contentHash(s: ScanIdentity): string {
	// One key per issue: its identity (see issueIdentity) at the most severe rating any of
	// its locations got, sorted so the same set in any order hashes identically. Unknown
	// severities are dropped. For findings without a ruleId the identity is the legacy
	// file+title fingerprint, so these keys — and therefore every hash stored before
	// agent-supplied identity existed — are unchanged.
	const worst = new Map<string, number>();
	for (const f of s.findings) {
		const rank = SEVERITY_ORDER.indexOf(f.severity);
		if (rank < 0) continue;
		const id = issueIdentity(f);
		const cur = worst.get(id);
		if (cur === undefined || rank < cur) worst.set(id, rank);
	}
	const keys = [...worst].map(([id, rank]) => `${SEVERITY_ORDER[rank]}:${id}`).sort();
	// Normalize commit/model/engine here so identity is the single source of truth:
	// the live POST path trims these, but a content_hash backfilled from a legacy
	// row reads the stored value verbatim (older writers didn't trim). Trimming at
	// the hash makes a post-upgrade retry of such a row dedup instead of inserting a
	// twin. Encode as a structured JSON tuple rather than a delimiter-joined string:
	// a raw separator (e.g. '\n') could appear inside an agent-controlled value and
	// let two distinct scans collide; JSON escaping keeps field boundaries
	// unambiguous regardless of field contents.
	// Continuity-aware submissions preserve reported evidence in content identity. The
	// canonical issue ID is NOT a replacement for source identity or source snapshots.
	// Legacy payloads keep their byte-identical historical content hashes.
	const raw = s.findings.some(
		(f) =>
			f.issueId !== undefined || f.continuityEvidence !== undefined || f.noveltyReason !== undefined
	)
		? s.findings.map(reportedFindingKey).sort()
		: null;
	const canonical = JSON.stringify(
		raw === null
			? [s.commit.trim(), s.model.trim(), s.engine.trim(), keys]
			: ['CONTINUITY-1', s.commit.trim(), s.model.trim(), s.engine.trim(), raw]
	);
	return createHash('sha256').update(canonical).digest('hex');
}
