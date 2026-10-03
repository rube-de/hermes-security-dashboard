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
	/** Free-text justification — required for false_positive / accepted_risk on crit/high. */
	note: string;
	/** Actor who triaged this finding (from x-hermes-user header, or 'unknown'). */
	triagedBy: string;
	createdAt: number;
	updatedAt: number;
}

/** One place an issue was reported in a review. */
export interface FindingLocation {
	file: string;
	line: number;
	/** Agent-reported enclosing function/symbol; '' when not sent. */
	locationKey: string;
}

/** A security issue as rendered in a report: every finding sharing an identity
 *  (`fingerprint`) in one review, with the top-level fields taken from its most severe
 *  (then earliest-reported) location. */
export interface Finding {
	severity: Severity;
	title: string;
	file: string;
	line: number;
	cwe: string;
	description: string;
	code: string;
	recommendation: string;
	/** Agent-reported detector/rule id (e.g. `reentrancy-eth`); '' when not sent. */
	ruleId: string;
	/** Agent-reported enclosing function/symbol (e.g. `Vault.withdraw`); '' when not sent. */
	locationKey: string;
	/** Every location of this issue in the review, ordered by file then line (≥ 1). */
	locations: FindingLocation[];
	/** Whether this finding is new relative to the previous review of the same repo. */
	isNew: boolean;
	/** How many consecutive runs this finding has been open. */
	openRuns: number;
	/** Age in hours since first detected. */
	ageHours: number;
	/** Stable per-repo issue identity: ruleId + file + locationKey when the agent sent a
	 *  ruleId, else the legacy file + title hash. Addresses triage writes. */
	fingerprint: string;
	/** Human triage verdict, or null when untriaged ("open"). */
	triage: Triage | null;
}

/** A resolved finding (present in the prior run, gone now). */
export interface ResolvedFinding {
	severity: Severity;
	title: string;
	file: string;
	/** Issue identity of the resolved finding (see Finding.fingerprint). */
	fingerprint: string;
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
	/** Epoch-ms. */
	createdAt: number;
	/** Scan duration in seconds. */
	durationSecs: number;
	counts: SeverityCounts;
	clean: boolean;
	/** Repository-first discoveries in this scan, including those found on a re-scan. */
	newCount: number;
	/** Stored first-scan resolution snapshot against the preceding commit's union. */
	resolvedCount: number;
	hasDelta: boolean;
}

/** Full review with findings, diff and optional sanitized HTML body. */
export interface ReviewDetail extends ReviewSummary {
	engine: string;
	/** Version of the agent that produced the review; '' when unreported. */
	agentVersion: string;
	summary: string;
	lines: number;
	filesScanned: number;
	findings: Finding[];
	/** Findings excluded from `counts` by triage (false-positive / accepted-risk). They
	 *  still appear in `findings` (rendered dimmed). */
	quietedCount: number;
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
	/** Status counts: the union of findings across all scans of the current commit,
	 *  excluding findings quieted by triage (false-positive / accepted-risk). */
	counts: SeverityCounts;
	/** How many head-commit findings were quieted out of `counts` by triage. Raw total
	 *  is `counts.total + quietedCount`. */
	quietedCount: number;
	status: 'flagged' | 'clean';
	clean: boolean;
	scanning: boolean;
	/** Earliest first-seen epoch-ms among open crit/high issues in the head-commit union;
	 *  null when none remain after triage quieting. */
	oldestOpenAt: number | null;
	/** Epoch-ms of the current commit's latest scan, or null if never scanned. */
	lastRunAt: number | null;
	/** Duration in seconds of that scan, or null if never scanned. */
	lastDurationSecs: number | null;
	filesScanned: number;
	/** The repo's current commit (most recently introduced), or null if never scanned. */
	headCommit: string | null;
	/** How many scans the current commit has — `counts` unions all of them. */
	headScanCount: number;
}

/** One scan within a commit's history group. Counts exclude quieted issues. */
export interface CommitScan {
	reviewId: string;
	model: string;
	/** Epoch-ms when this scan was created. */
	createdAt: number;
	counts: SeverityCounts;
	/** Issues in this scan found by no other model on the same commit. */
	uniqueCount: number;
}

/** A code state, unioned across scans and compared with the preceding code state. */
export interface CommitGroup {
	commit: string;
	/** Epoch-ms of this commit's first scan; re-scans do not reorder history. */
	createdAt: number;
	/** Worst severity per issue across all scans, excluding quieted issues. */
	counts: SeverityCounts;
	/** Issues absent from the preceding commit's union; zero without a predecessor. */
	newCount: number;
	/** Issues in the preceding union but absent here; zero without a predecessor. */
	fixedCount: number;
	/** At least one scan, newest first. */
	scans: CommitScan[];
}

export interface RepoDetail extends RepoSummary {
	reviews: ReviewSummary[];
	/** Commit groups, most recently introduced first; scans within each are newest first. */
	commits: CommitGroup[];
}

/** A daily aggregate bucket exposed by GET /api/trends. */
export interface TrendBucket {
	/** "M/D" label for the UTC day. */
	day: string;
	/** UTC midnight, epoch-ms. */
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
	/** Findings quieted by triage (false-positive / accepted-risk) across all repos —
	 *  excluded from `totals`. */
	quietedTotal: number;
	flagged: number;
	clean: number;
	reposCount: number;
	reviewsAllTime: number;
	/** Mean scan duration across all reviews in whole seconds, or null if there are none. */
	avgScanSecs: number | null;
	/** Epoch-ms of the most recent review of any repo, or null if there are none. */
	lastRunAt: number | null;
	/** Agent-reported next planned run (epoch-ms), or null if unscheduled. */
	nextRunAt: number | null;
	/** Daily UTC buckets for the current day and the preceding 13 days. */
	trend: TrendBucket[];
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
	dataVersion: number;
}
