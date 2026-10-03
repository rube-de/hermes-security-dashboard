import type { Severity, SeverityCounts, TriageStatus } from './types';

export const SEVERITIES: Severity[] = ['crit', 'high', 'med', 'low'];

/** Numeric rank per severity (0 = most severe), derived from SEVERITIES so the
 *  ordering has a single source of truth (used to pick the worst severity when
 *  unioning a commit's scans, and to build the SQL ordering). */
export const SEV_RANK: Record<Severity, number> = Object.fromEntries(
	SEVERITIES.map((s, i) => [s, i])
) as Record<Severity, number>;

export const SEV_LABEL: Record<Severity, string> = {
	crit: 'Critical',
	high: 'High',
	med: 'Medium',
	low: 'Low'
};

/** Single-letter labels used in the compact severity pills. */
export const SEV_SHORT: Record<Severity, string> = {
	crit: 'C',
	high: 'H',
	med: 'M',
	low: 'L'
};

/** CSS custom-property names for each severity colour. */
export const SEV_VAR: Record<Severity, string> = {
	crit: 'var(--crit)',
	high: 'var(--high)',
	med: 'var(--med)',
	low: 'var(--low)'
};

export const SEV_BG_VAR: Record<Severity, string> = {
	crit: 'var(--critB)',
	high: 'var(--highB)',
	med: 'var(--medB)',
	low: 'var(--lowB)'
};

/** Triage statuses in display order (drives the verdict buttons). */
export const TRIAGE_STATUSES: TriageStatus[] = ['acknowledged', 'false_positive', 'accepted_risk'];

export const TRIAGE_LABEL: Record<TriageStatus, string> = {
	acknowledged: 'Acknowledged',
	false_positive: 'False positive',
	accepted_risk: 'Accepted risk'
};

/** The two verdicts that "quiet" a finding — drop it from actionable counts and a repo's
 *  flagged/clean status at read time. `acknowledged` is deliberately NOT here: it marks a
 *  finding as seen-but-real, so it keeps counting. */
export const QUIETING = new Set<TriageStatus>(['false_positive', 'accepted_risk']);

export function quiets(t: { status: TriageStatus } | null | undefined): boolean {
	return !!t && QUIETING.has(t.status);
}

export const LANG_COLOR: Record<string, string> = {
	Rust: '#DEA584',
	Go: '#00ADD8',
	Solidity: '#9C7BD6',
	TypeScript: '#3178C6',
	JavaScript: '#F1E05A',
	Python: '#3572A5'
};

export function langColor(lang: string): string {
	return LANG_COLOR[lang] ?? '#888';
}

export function emptyCounts(): SeverityCounts {
	return { crit: 0, high: 0, med: 0, low: 0, total: 0 };
}

export function countSeverities(items: { severity: Severity }[]): SeverityCounts {
	const c = emptyCounts();
	for (const it of items) c[it.severity]++;
	c.total = c.crit + c.high + c.med + c.low;
	return c;
}

export interface SevPill {
	key: Severity;
	text: string;
	color: string;
	bg: string;
}

export function sevPills(counts: SeverityCounts): SevPill[] {
	return SEVERITIES.filter((k) => counts[k] > 0).map((k) => ({
		key: k,
		text: `${SEV_SHORT[k]} ${counts[k]}`,
		color: SEV_VAR[k],
		bg: SEV_BG_VAR[k]
	}));
}

/** Highest-severity colour for a status dot. */
export function statusColor(counts: SeverityCounts): string {
	if (counts.total === 0) return 'var(--accent)';
	if (counts.crit > 0) return 'var(--crit)';
	if (counts.high > 0) return 'var(--high)';
	if (counts.med > 0) return 'var(--med)';
	return 'var(--low)';
}

/** Repo status text: "Clean", or the open-issue count ("1 issue", "3 issues"). */
export function fmtStatus(counts: SeverityCounts): string {
	if (counts.total === 0) return 'Clean';
	return `${counts.total} issue${counts.total > 1 ? 's' : ''}`;
}

/* ------------------------------------------------------------------ */
/* time                                                                */
/* ------------------------------------------------------------------ */
// The API returns raw epoch-ms timestamps and second counts; these helpers turn them
// into display text on the client. Absolute times format in an explicit IANA `timeZone`
// or, when it is omitted, the runtime's own zone (the browser's, client-side). Relative
// times take `now` from the shared ticking clock ($lib/clock.svelte).

/** Compact span for a non-negative whole-minute count: "14m", "2h 14m", "3h", "2d". */
function fmtSpan(mins: number): string {
	if (mins < 60) return `${mins}m`;
	if (mins < 24 * 60) {
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}
	return `${Math.round(mins / (24 * 60))}d`;
}

/** "2h 14m ago" for a past timestamp; "just now" under a minute (or if `ts` is ahead of `now`). */
export function fmtAgo(ts: number, now: number): string {
	const mins = Math.round((now - ts) / 60_000);
	return mins < 1 ? 'just now' : `${fmtSpan(mins)} ago`;
}

/** "in 3h 46m" for a future timestamp; "due now" under a minute away or once it has passed. */
export function fmtUntil(ts: number, now: number): string {
	const mins = Math.round((ts - now) / 60_000);
	return mins < 1 ? 'due now' : `in ${fmtSpan(mins)}`;
}

const SHORT_DATE: Intl.DateTimeFormatOptions = {
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
};
const FULL_DATE: Intl.DateTimeFormatOptions = {
	...SHORT_DATE,
	weekday: 'short',
	year: 'numeric',
	second: '2-digit',
	timeZoneName: 'short'
};

// Building an Intl.DateTimeFormat costs far more than using one: keep one per (style, zone).
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Date parts of `ts` in `timeZone`. Text is assembled from parts rather than `format()`
 *  so separators can't differ between ICU builds: SSR (Node) and hydration (browser)
 *  must produce identical strings for the same zone. */
function dateParts(ts: number, style: 'short' | 'full', timeZone?: string) {
	const key = `${style}|${timeZone ?? ''}`;
	let f = formatters.get(key);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			...(style === 'short' ? SHORT_DATE : FULL_DATE),
			timeZone
		});
		formatters.set(key, f);
	}
	const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
	for (const { type, value } of f.formatToParts(ts)) parts[type] = value;
	return parts;
}

/** "Jun 16 · 09:46" in `timeZone` (default: the runtime's local zone). */
export function fmtDate(ts: number, timeZone?: string): string {
	const p = dateParts(ts, 'short', timeZone);
	return `${p.month} ${p.day} · ${p.hour}:${p.minute}`;
}

/** "Tue, Jun 16, 2026, 09:46:12 GMT+2": full date, time and zone name, for `title` tooltips. */
export function fmtDateFull(ts: number, timeZone?: string): string {
	const p = dateParts(ts, 'full', timeZone);
	return `${p.weekday}, ${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName}`;
}

/** "3m 51s" style duration from seconds. */
export function fmtDur(secs: number): string {
	const s = Math.max(0, Math.round(secs));
	return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** "1,284" style grouped integer. */
export function fmtInt(n: number): string {
	return n.toLocaleString('en-US');
}

/** mm:ss elapsed label from a number of seconds. */
export function fmtElapsed(secs: number): string {
	const s = Math.max(0, Math.floor(secs));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
