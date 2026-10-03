import { db } from './db';
import type { Triage, TriageStatus } from '$lib/types';

export const VALID_TRIAGE = new Set<TriageStatus>(['acknowledged', 'false_positive', 'accepted_risk']);
// The two verdicts that "quiet" a finding — drop it from actionable counts and a repo's
// flagged/clean status at read time. `acknowledged` is deliberately NOT here: it marks a
// finding as seen-but-real, so it keeps counting.
export const QUIETING = new Set<TriageStatus>(['false_positive', 'accepted_risk']);

export function quiets(t: { status: TriageStatus } | null | undefined): boolean {
	return !!t && QUIETING.has(t.status);
}

/**
 * Every human triage verdict for a repo, keyed by finding fingerprint. One repo-scoped
 * PK query, joined onto findings at read time — a tag survives every agent re-run untouched
 * because insertReview never writes this table. Unknown statuses are dropped defensively.
 */
export function triageMapForRepo(repoId: string): Map<string, Triage> {
	const rows = db
		.prepare(
			'SELECT fingerprint, status, note, created_at, updated_at FROM finding_triage WHERE repo_id = ?'
		)
		.all(repoId) as {
		fingerprint: string;
		status: TriageStatus;
		note: string;
		created_at: number;
		updated_at: number;
	}[];
	const m = new Map<string, Triage>();
	for (const r of rows) {
		if (!VALID_TRIAGE.has(r.status)) continue;
		m.set(r.fingerprint, {
			status: r.status,
			note: r.note,
			createdAt: r.created_at,
			updatedAt: r.updated_at
		});
	}
	return m;
}

/** Latest stored title/file for a finding identity, or null if no finding in the repo
 *  carries this fingerprint. The authoritative source for the tag-time snapshot. */
export function findingIdentity(repoId: string, fp: string): { title: string; file: string } | null {
	const row = db
		.prepare(
			'SELECT title, file FROM findings WHERE repo_id = ? AND fingerprint = ? ORDER BY first_seen_at DESC, id DESC LIMIT 1'
		)
		.get(repoId, fp) as { title: string; file: string } | undefined;
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
	at = Date.now()
): boolean {
	const ident = findingIdentity(repoId, fp);
	if (!ident) return false;
	db.prepare(
		`INSERT INTO finding_triage
		 (repo_id, fingerprint, status, note, fp_title, fp_file, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(repo_id, fingerprint) DO UPDATE SET
		   status = excluded.status,
		   note = excluded.note,
		   updated_at = excluded.updated_at`
	).run(repoId, fp, status, note, ident.title, ident.file, at, at);
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
