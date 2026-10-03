import { db } from './db';
import type { ScanState } from '$lib/types';

export interface ScanRow {
	id: number;
	active: number;
	repo_id: string | null;
	commit_hash: string | null;
	current_file: string | null;
	progress: number;
	engine: string | null;
	started_at: number | null;
}

export function getScan(): ScanState {
	const r = db.prepare('SELECT * FROM scan WHERE id = 1').get() as ScanRow | undefined;
	if (!r || r.active !== 1) {
		return {
			active: false,
			repoId: null,
			commit: null,
			currentFile: null,
			progress: 0,
			engine: null,
			startedAt: null
		};
	}
	return {
		active: true,
		repoId: r.repo_id,
		commit: r.commit_hash,
		currentFile: r.current_file,
		progress: r.progress,
		engine: r.engine,
		startedAt: r.started_at
	};
}

export interface ScanInput {
	active: boolean;
	repoId?: string | null;
	commit?: string | null;
	currentFile?: string | null;
	progress?: number;
	engine?: string | null;
	startedAt?: number | null;
}

export function setScan(input: ScanInput): ScanState {
	if (!input.active) {
		db.prepare(
			`UPDATE scan SET active = 0, repo_id = NULL, commit_hash = NULL, current_file = NULL,
			 progress = 0, engine = NULL, started_at = NULL WHERE id = 1`
		).run();
		return getScan();
	}
	const startedAt = input.startedAt ?? Date.now();
	db.prepare(
		`UPDATE scan SET active = 1, repo_id = ?, commit_hash = ?, current_file = ?,
		 progress = ?, engine = ?, started_at = ? WHERE id = 1`
	).run(
		input.repoId ?? null,
		input.commit ?? null,
		input.currentFile ?? null,
		Math.max(0, Math.min(100, input.progress ?? 0)),
		input.engine ?? 'slither+semgrep+llm',
		startedAt
	);
	return getScan();
}
