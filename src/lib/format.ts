import type { Severity, SeverityCounts } from './types';

export const SEVERITIES: Severity[] = ['crit', 'high', 'med', 'low'];

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2h 14m ago" style relative label from a timestamp. */
export function fmtAgo(ts: number, now: number = Date.now()): string {
	const mins = Math.max(0, Math.round((now - ts) / 60000));
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hrs = mins / 60;
	if (hrs < 24) {
		const h = Math.floor(hrs);
		const m = Math.round(mins - h * 60);
		return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
	}
	return `${Math.round(hrs / 24)}d ago`;
}

/** "in 3h 46m" style countdown to a future timestamp. */
export function fmtUntil(ts: number, now: number = Date.now()): string {
	const mins = Math.max(0, Math.round((ts - now) / 60000));
	if (mins < 1) return 'due now';
	if (mins < 60) return `${mins}m`;
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** "Jun 16 · 09:46" style absolute label. */
export function fmtDate(ts: number): string {
	const d = new Date(ts);
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${hh}:${mm}`;
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
