import { db } from './db';
import type { Severity, Triage, TriageStatus } from '$lib/types';

import { QUIETING, quiets } from '$lib/format';

export { QUIETING, quiets };
export const VALID_TRIAGE = new Set<TriageStatus>(['acknowledged', 'false_positive', 'accepted_risk']);

/**
 * Every human triage verdict for a repo, keyed by finding fingerprint. One repo-scoped
 * PK query, joined onto findings at read time — a tag survives every agent re-run untouched
 * because insertReview never writes this table. Unknown statuses are dropped defensively.
 */
export function triageMapForRepo(repoId: string): Map<string, Triage> {
	const rows = db
		.prepare(
			'SELECT fingerprint, status, note, created_at, updated_at, triaged_by FROM finding_triage WHERE repo_id = ?'
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
		m.set(r.fingerprint, {
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
 * Upsert a human triage verdict for a finding identity. Last-write-wins on the single
 * (repo_id, fingerprint) row; created_at is preserved across updates, updated_at moves.
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
	const r = db
		.prepare('DELETE FROM finding_triage WHERE repo_id = ? AND fingerprint = ?')
		.run(repoId, fp);
	return r.changes > 0;
}
