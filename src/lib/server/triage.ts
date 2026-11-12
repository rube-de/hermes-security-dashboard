import { resolveIssueId, issueMembers } from './issue-continuity';
import { db } from './db';
import type { Severity, Triage, TriageStatus } from '$lib/types';

import { QUIETING, quiets } from '$lib/format';

export { QUIETING, quiets };
export const VALID_TRIAGE = new Set<TriageStatus>([
	'acknowledged',
	'false_positive',
	'accepted_risk'
]);

/**
 * Human triage for a repo, keyed by currently resolved canonical issue ID. One repo-scoped
 * PK query, joined onto findings at read time — a tag survives every agent re-run untouched
 * because insertReview never writes this table. Identical aliased tags select the oldest
 * record deterministically; conflicting verdicts are rejected before alias creation.
 * Unknown statuses are dropped defensively.
 */
export function triageMapForRepo(repoId: string): Map<string, Triage> {
	const rows = db
		.prepare(
			'SELECT fingerprint, status, note, created_at, updated_at, triaged_by FROM finding_triage WHERE repo_id = ? ORDER BY created_at ASC, fingerprint ASC'
		)
		.all(repoId) as {
		fingerprint: string;
		status: TriageStatus;
		note: string;
		created_at: number;
		updated_at: number;
		triaged_by: string;
	}[];
	const m = new Map<string, Triage>();
	for (const r of rows) {
		if (!VALID_TRIAGE.has(r.status)) continue;
		const issueId = resolveIssueId(repoId, r.fingerprint);
		const prior = m.get(issueId);
		if (prior && (prior.status !== r.status || prior.note !== r.note))
			throw new Error(
				'conflicting human triage in canonical component; explicit reconciliation required'
			);
		if (prior) continue;
		m.set(issueId, {
			status: r.status,
			note: r.note,
			triagedBy: r.triaged_by || 'unknown',
			createdAt: r.created_at,
			updatedAt: r.updated_at
		});
	}
	return m;
}
/** Latest stored title/file for a finding identity, or null if no finding in the repo
 *  carries this fingerprint. The authoritative source for the tag-time snapshot. */
export function findingIdentity(
	repoId: string,
	fp: string
): { title: string; file: string; severity: Severity } | null {
	const row = db
		.prepare(
			'SELECT title, file, severity FROM findings WHERE repo_id = ? AND fingerprint = ? ORDER BY first_seen_at DESC, id DESC LIMIT 1'
		)
		.get(repoId, fp) as { title: string; file: string; severity: Severity } | undefined;
	return row ?? null;
}
/**
 * Explicitly update a canonical issue through either raw fingerprint or root ID.
 * Existing component tag rows are updated together (never re-keyed); created_at
 * and tag-time title/file snapshots survive. If none exists, create a root tag.
 * Returns false WITHOUT writing if no finding in the repo carries this fingerprint, so the
 * caller can 404 rather than store an orphan tag. The fp_title/fp_file snapshot is taken
 * from the finding itself, not the caller, so it can't be spoofed.
 */
export function setTriage(
	repoId: string,
	fp: string,
	status: TriageStatus,
	note = '',
	triagedBy = 'unknown',
	at = Date.now()
): boolean {
	const ident = findingIdentity(repoId, fp);
	if (!ident) return false;
	const actor = triagedBy.trim().slice(0, 100) || 'unknown';
	const canonicalId = resolveIssueId(repoId, fp);
	const members = issueMembers(repoId, canonicalId);
	const updated = db
		.prepare(
			`UPDATE finding_triage SET status = ?, note = ?, updated_at = ?, triaged_by = ? WHERE repo_id = ? AND fingerprint IN (${members.map(() => '?').join(',') || 'NULL'})`
		)
		.run(status, note, at, actor, repoId, ...members);
	if (updated.changes > 0) return true;
	fp = canonicalId;
	db.prepare(
		`INSERT INTO finding_triage
		 (repo_id, fingerprint, status, note, fp_title, fp_file, created_at, updated_at, triaged_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(repo_id, fingerprint) DO UPDATE SET
		   status = excluded.status,
		   note = excluded.note,
		   updated_at = excluded.updated_at,
		   triaged_by = excluded.triaged_by`
	).run(repoId, fp, status, note, ident.title, ident.file, at, at, actor);
	return true;
}

/** Clear a finding's triage verdict (back to open/untriaged). Idempotent; returns whether
 *  a row was actually removed. */
export function clearTriage(repoId: string, fp: string): boolean {
	const members = [...new Set([fp, ...issueMembers(repoId, resolveIssueId(repoId, fp))])];
	const r = db
		.prepare(
			`DELETE FROM finding_triage WHERE repo_id = ? AND fingerprint IN (${members.map(() => '?').join(',')})`
		)
		.run(repoId, ...members);
	return r.changes > 0;
}
