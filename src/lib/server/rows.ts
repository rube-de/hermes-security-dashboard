import type { Severity } from '$lib/types';

export const VALID_SEV = new Set<Severity>(['crit', 'high', 'med', 'low']);

export interface RepoRow {
	id: string;
	lang: string;
	description: string;
	path: string;
	branch: string;
	lines: number;
	created_at: number;
}

export interface ReviewRow {
	id: string;
	repo_id: string;
	commit_hash: string;
	model: string;
	trigger: string;
	engine: string;
	summary: string;
	html: string | null;
	duration_secs: number;
	lines: number;
	files_scanned: number;
	prev_commit: string | null;
	new_count: number;
	resolved_count: number;
	resolved_json: string;
	content_hash: string | null;
	created_at: number;
}

export interface FindingRow {
	id: number;
	review_id: string;
	repo_id: string;
	severity: Severity;
	title: string;
	file: string;
	line: number;
	cwe: string;
	description: string;
	code: string;
	recommendation: string;
	fingerprint: string;
	is_new: number;
	first_seen_at: number;
}
