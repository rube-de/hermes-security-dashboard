/** Severity keys used throughout the app and the agent API. */
export type Severity = 'crit' | 'high' | 'med' | 'low';

export interface SeverityCounts {
	crit: number;
	high: number;
	med: number;
	low: number;
	total: number;
}

/** Human triage verdict on a finding, persisted across agent re-runs and keyed on the
 *  finding's stable (repo, fingerprint) identity. `acknowledged` still counts toward a
 *  repo's status; `false_positive` and `accepted_risk` quiet it. */
export type TriageStatus = 'acknowledged' | 'false_positive' | 'accepted_risk';

export interface Triage {
	status: TriageStatus;
	/** Free-text justification — expected for false_positive / accepted_risk. */
	note: string;
	createdAt: number;
	updatedAt: number;
}

/** A single security finding as rendered in a report. */
export interface Finding {
	severity: Severity;
	title: string;
	file: string;
	line: number;
	cwe: string;
	description: string;
	code: string;
	recommendation: string;
	/** Whether this finding is new relative to the previous review of the same repo. */
	isNew: boolean;
	/** How many consecutive runs this finding has been open. */
	openRuns: number;
	/** Age in hours since first detected. */
	ageHours: number;
	/** Stable per-repo finding identity (sha1 of file+title) — addresses triage writes. */
	fingerprint: string;
	/** Human triage verdict, or null when untriaged ("open"). */
	triage: Triage | null;
}

/** A resolved finding (present in the prior run, gone now). */
export interface ResolvedFinding {
	severity: Severity;
	title: string;
	file: string;
}

/** Lightweight review summary used in lists/tables. */
export interface ReviewSummary {
	id: string;
	repoId: string;
	commit: string;
	/** LLM model that produced the review (e.g. claude-opus-4-8); '' if unreported. */
	model: string;
	prevCommit: string | null;
	trigger: string;
	createdAt: number;
	dateLabel: string;
	agoLabel: string;
	durationLabel: string;
	durationSecs: number;
	counts: SeverityCounts;
	clean: boolean;
	newCount: number;
	resolvedCount: number;
	hasDelta: boolean;
}

/** Full review with findings, diff and optional sanitized HTML body. */
export interface ReviewDetail extends ReviewSummary {
	engine: string;
	summary: string;
	lines: number;
	filesScanned: number;
	findings: Finding[];
	resolved: ResolvedFinding[];
	html: string | null;
	diff: { newCount: number; carriedCount: number; resolvedCount: number };
	hasPrev: boolean;
}

/** Repository row with its current-commit status. */
export interface RepoSummary {
	id: string;
	lang: string;
	description: string;
	path: string;
	branch: string;
	lines: number;
	langColor: string;
	/** Status counts: the union of findings across all scans of the current commit. */
	counts: SeverityCounts;
	status: 'flagged' | 'clean';
	statusLabel: string;
	clean: boolean;
	glyph: string;
	scanning: boolean;
	lastRunLabel: string;
	lastDurationLabel: string;
	filesScanned: number;
	/** The repo's current commit (most recently introduced), or null if never scanned. */
	headCommit: string | null;
	/** How many scans the current commit has — `counts` unions all of them. */
	headScanCount: number;
}

export interface RepoDetail extends RepoSummary {
	reviews: ReviewSummary[];
}

export interface TrendPoint {
	day: string;
	count: number;
}

/** A daily aggregate bucket exposed by GET /api/trends. */
export interface TrendBucket {
	/** "M/D" label for the day. */
	day: string;
	/** Start-of-day timestamp (local), ms. */
	date: number;
	/** Findings first introduced on this day. */
	newFindings: number;
	/** Findings resolved on this day. */
	resolvedFindings: number;
	/** Reviews that ran on this day. */
	reviews: number;
}

export interface Overview {
	totals: SeverityCounts;
	flagged: number;
	clean: number;
	reposCount: number;
	reviewsAllTime: number;
	avgScanLabel: string;
	orgLabel: string;
	lastRunLabel: string;
	/** Agent-reported next planned run (epoch-ms), or null if unscheduled. */
	nextRunAt: number | null;
	nextRunLabel: string;
	trend: TrendPoint[];
	repos: RepoSummary[];
}

/** Live active-scan state, polled by the header banner. */
export interface ScanState {
	active: boolean;
	repoId: string | null;
	commit: string | null;
	currentFile: string | null;
	progress: number;
	engine: string | null;
	startedAt: number | null;
}
