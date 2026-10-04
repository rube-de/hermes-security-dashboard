import { describe, it, expect } from 'vitest';
import { emptyCounts, fmtAgo, fmtDate, fmtDateFull, fmtStatus, fmtUntil } from '$lib/format';

const NOW = Date.UTC(2026, 5, 16, 12, 0, 0);
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('fmtAgo', () => {
	it('reads "just now" under half a minute, and for timestamps ahead of now', () => {
		expect(fmtAgo(NOW, NOW)).toBe('just now');
		expect(fmtAgo(NOW - 29 * SEC, NOW)).toBe('just now');
		expect(fmtAgo(NOW + 5 * MIN, NOW)).toBe('just now');
	});

	it('counts minutes below an hour', () => {
		expect(fmtAgo(NOW - 30 * SEC, NOW)).toBe('1m ago');
		expect(fmtAgo(NOW - 59 * MIN, NOW)).toBe('59m ago');
	});

	it('counts hours and minutes below a day', () => {
		expect(fmtAgo(NOW - HOUR, NOW)).toBe('1h ago');
		expect(fmtAgo(NOW - (2 * HOUR + 14 * MIN), NOW)).toBe('2h 14m ago');
		expect(fmtAgo(NOW - (23 * HOUR + 59 * MIN), NOW)).toBe('23h 59m ago');
	});

	it('rounds to whole days from a day on', () => {
		expect(fmtAgo(NOW - DAY, NOW)).toBe('1d ago');
		expect(fmtAgo(NOW - 36 * HOUR, NOW)).toBe('2d ago');
		expect(fmtAgo(NOW - 9 * DAY, NOW)).toBe('9d ago');
	});
});

describe('fmtUntil', () => {
	it('reads "due now" under half a minute away, and once the time has passed', () => {
		expect(fmtUntil(NOW, NOW)).toBe('due now');
		expect(fmtUntil(NOW + 29 * SEC, NOW)).toBe('due now');
		expect(fmtUntil(NOW - 2 * HOUR, NOW)).toBe('due now');
	});

	it('counts down minutes, hours and days', () => {
		expect(fmtUntil(NOW + MIN, NOW)).toBe('in 1m');
		expect(fmtUntil(NOW + 59 * MIN, NOW)).toBe('in 59m');
		expect(fmtUntil(NOW + 3 * HOUR, NOW)).toBe('in 3h');
		expect(fmtUntil(NOW + (3 * HOUR + 46 * MIN), NOW)).toBe('in 3h 46m');
		expect(fmtUntil(NOW + DAY, NOW)).toBe('in 1d');
	});
});

describe('fmtDate', () => {
	const ts = Date.UTC(2026, 5, 16, 9, 46, 12);

	it('formats month, day and 24h time in the given zone', () => {
		expect(fmtDate(ts, 'UTC')).toBe('Jun 16 · 09:46');
		expect(fmtDate(ts, 'Asia/Kolkata')).toBe('Jun 16 · 15:16');
	});

	it('moves to the zone-local calendar day', () => {
		expect(fmtDate(Date.UTC(2026, 5, 16, 0, 5), 'America/New_York')).toBe('Jun 15 · 20:05');
	});

	it('renders the first hour after midnight as 00, not 24', () => {
		expect(fmtDate(Date.UTC(2026, 0, 1, 0, 5), 'UTC')).toBe('Jan 1 · 00:05');
	});
});

describe('fmtDateFull', () => {
	it('spells out the full date, seconds and zone name', () => {
		expect(fmtDateFull(Date.UTC(2026, 5, 16, 9, 46, 12), 'UTC')).toBe('Tue, Jun 16, 2026, 09:46:12 UTC');
	});

	it("names the zone's daylight-saving offset in effect at that instant", () => {
		const zone = 'America/New_York';
		expect(fmtDateFull(Date.UTC(2026, 5, 16, 9, 46, 12), zone)).toBe('Tue, Jun 16, 2026, 05:46:12 EDT');
		expect(fmtDateFull(Date.UTC(2026, 0, 16, 9, 46, 12), zone)).toBe('Fri, Jan 16, 2026, 04:46:12 EST');
	});
});

describe('fmtStatus', () => {
	it('reads Clean with no open findings, else the singular/plural issue count', () => {
		expect(fmtStatus(emptyCounts())).toBe('Clean');
		expect(fmtStatus({ ...emptyCounts(), high: 1, total: 1 })).toBe('1 issue');
		expect(fmtStatus({ ...emptyCounts(), crit: 1, low: 2, total: 3 })).toBe('3 issues');
	});
});
