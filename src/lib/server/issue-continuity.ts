import { db } from './db';
import { reportedFindingKey } from './content-hash';
import { issueIdentity } from './fingerprint';
import type { FindingInput } from './ingest';

export const ISSUE_ID = /^[0-9a-f]{16}$/;
export function requireIssueId(value: unknown, name = 'issueId'): asserts value is string {
	if (typeof value !== 'string' || !ISSUE_ID.test(value))
		throw new Error(`${name} must be exactly 16 lowercase hex characters`);
}
export function requireReason(value: unknown, name: string, max = 4000): asserts value is string {
	if (typeof value !== 'string' || !value.trim() || value.length > max)
		throw new Error(`${name} must be a nonblank string of at most ${max} characters`);
}
export function validateContinuity(f: FindingInput): void {
	if (f.issueId !== undefined) requireIssueId(f.issueId);
	if (f.issueId !== undefined && f.noveltyReason !== undefined)
		throw new Error('issueId and noveltyReason are contradictory');
	if (f.continuityEvidence !== undefined) {
		requireReason(f.continuityEvidence, 'continuityEvidence', 2000);
		if (f.issueId === undefined) throw new Error('continuityEvidence requires issueId');
	}
	if (f.noveltyReason !== undefined) requireReason(f.noveltyReason, 'noveltyReason', 2000);
	if (f.issueId !== undefined && f.issueId !== issueIdentity(f))
		requireReason(f.continuityEvidence, 'continuityEvidence', 2000);
}

/** Do not let occurrence deduplication silently discard a submitted continuity claim. */
export function validateContinuityOccurrences(findings: FindingInput[]): void {
	const groups = new Map<string, FindingInput[]>();
	for (const f of findings) {
		const key = JSON.stringify([
			issueIdentity(f),
			f.line ?? 0,
			(f.locationKey ?? '').trim().toLowerCase()
		]);
		const group = groups.get(key) ?? [];
		group.push(f);
		groups.set(key, group);
	}
	for (const group of groups.values()) {
		if (
			!group.some(
				(f) =>
					f.issueId !== undefined ||
					f.continuityEvidence !== undefined ||
					f.noveltyReason !== undefined
			)
		)
			continue;
		const signatures = new Set(group.map(reportedFindingKey));
		if (signatures.size > 1)
			throw new Error(
				'conflicting duplicate occurrence with continuity metadata; submit one complete report per place'
			);
	}
}

/** Raw fingerprints stay immutable. Only explicit, audited edges change issue membership. */
export function issueResolver(repoId: string): (fingerprint: string) => string {
	const rows = db
		.prepare('SELECT fingerprint, issue_id FROM issue_aliases WHERE repo_id = ?')
		.all(repoId) as { fingerprint: string; issue_id: string }[];
	const edges = new Map(rows.map((r) => [r.fingerprint, r.issue_id]));
	const roots = new Map<string, string>();
	return (fingerprint) => {
		const seen = new Set<string>();
		let id = fingerprint;
		while (edges.has(id)) {
			if (seen.has(id)) throw new Error('cyclic issue aliases');
			seen.add(id);
			if (roots.has(id)) {
				id = roots.get(id)!;
				break;
			}
			id = edges.get(id)!;
		}
		for (const member of seen) roots.set(member, id);
		return id;
	};
}
export function resolveIssueId(repoId: string, fingerprint: string): string {
	return issueResolver(repoId)(fingerprint);
}

export interface AliasAudit {
	actor: string;
	sourceReviewIds: string[];
}
export interface IssueAlias {
	fingerprint: string;
	issueId: string;
	reason: string;
	createdAt: number;
	actor: string;
	sourceReviewIds: string[];
}
export function listIssueAliases(repoId: string): IssueAlias[] {
	const rows = db
		.prepare(
			'SELECT fingerprint, issue_id, reason, created_at, actor, source_review_ids FROM issue_aliases WHERE repo_id = ? ORDER BY created_at, fingerprint'
		)
		.all(repoId) as {
		fingerprint: string;
		issue_id: string;
		reason: string;
		created_at: number;
		actor: string;
		source_review_ids: string;
	}[];
	return rows.map((r) => ({
		fingerprint: r.fingerprint,
		issueId: r.issue_id,
		reason: r.reason,
		createdAt: r.created_at,
		actor: r.actor,
		sourceReviewIds: JSON.parse(r.source_review_ids)
	}));
}
export function associateIssue(
	repoId: string,
	fingerprint: string,
	issueId: string,
	reason: string,
	audit: AliasAudit,
	existingPolicy: 'membership' | 'exact-edge' = 'membership'
): void {
	if (
		!db
			.prepare('SELECT 1 FROM findings WHERE repo_id = ? AND fingerprint = ? LIMIT 1')
			.get(repoId, issueId)
	)
		throw new Error('unknown issueId in repository');
	if (resolveIssueId(repoId, issueId) !== issueId)
		throw new Error('issueId must be a canonical root; cyclic aliases forbidden');
	if (fingerprint === issueId) return;
	const direct = db
		.prepare('SELECT issue_id FROM issue_aliases WHERE repo_id = ? AND fingerprint = ?')
		.get(repoId, fingerprint) as { issue_id: string } | undefined;
	if (existingPolicy === 'exact-edge' && direct && direct.issue_id !== issueId)
		throw new Error('conflicting direct issue alias; repointing is forbidden');
	const existing = resolveIssueId(repoId, fingerprint);
	if (existing === issueId) return;
	if (existing !== fingerprint) throw new Error('conflicting issue alias');
	const members = new Set([...issueMembers(repoId, fingerprint), ...issueMembers(repoId, issueId)]);
	const verdicts = (
		db
			.prepare('SELECT fingerprint, status, note FROM finding_triage WHERE repo_id = ?')
			.all(repoId) as { fingerprint: string; status: string; note: string }[]
	).filter((r) => members.has(r.fingerprint));
	if (new Set(verdicts.map((v) => JSON.stringify([v.status, v.note]))).size > 1)
		throw new Error('conflicting human triage; reconcile before associating issues');
	db.prepare(
		'INSERT INTO issue_aliases (repo_id, fingerprint, issue_id, reason, created_at, actor, source_review_ids) VALUES (?, ?, ?, ?, ?, ?, ?)'
	).run(
		repoId,
		fingerprint,
		issueId,
		reason,
		Date.now(),
		audit.actor,
		JSON.stringify(audit.sourceReviewIds)
	);
}

/** Derived earliest discovery; historical first_seen_at snapshots remain immutable. */
export function issueFirstSeenTimes(repoId: string): Map<string, number> {
	const resolve = issueResolver(repoId);
	const rows = db
		.prepare(
			'SELECT fingerprint, MIN(first_seen_at) AS first_seen_at FROM findings WHERE repo_id = ? GROUP BY fingerprint'
		)
		.all(repoId) as { fingerprint: string; first_seen_at: number }[];
	const earliest = new Map<string, number>();
	for (const row of rows) {
		const id = resolve(row.fingerprint);
		earliest.set(id, Math.min(earliest.get(id) ?? Infinity, row.first_seen_at));
	}
	return earliest;
}

export function issueMembers(repoId: string, issueId: string): string[] {
	const rows = db
		.prepare('SELECT DISTINCT fingerprint FROM findings WHERE repo_id = ?')
		.all(repoId) as { fingerprint: string }[];
	const resolve = issueResolver(repoId);
	return rows.filter((r) => resolve(r.fingerprint) === issueId).map((r) => r.fingerprint);
}
