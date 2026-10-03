import { db } from './db';

/* ------------------------------------------------------------------ */
/* meta                                                                */
/* ------------------------------------------------------------------ */

export function getMeta(key: string, fallback: string): string {
	const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? fallback;
}

export function setMeta(key: string, value: string): void {
	db.prepare(
		'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	).run(key, value);
}

/** Persist the agent-reported next planned run (epoch-ms). null/≤0 clears it. */
export function setNextRun(at: number | null): void {
	setMeta('next_run_at', String(at && at > 0 ? at : 0));
}

/* ------------------------------------------------------------------ */
/* re-run requests (user asks; the agent picks them up next cycle)     */
/* ------------------------------------------------------------------ */

/** Record a user request to re-review `repoId` on the next Hermes cycle. */
export function requestRerun(repoId: string, at = Date.now()): number {
	setMeta(`rerun_req:${repoId}`, String(at));
	return at;
}

/** Pending re-run request timestamp for `repoId`, or null if none. */
export function getRerunRequest(repoId: string): number | null {
	const v = getMeta(`rerun_req:${repoId}`, '');
	return v ? Number(v) : null;
}
