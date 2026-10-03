import { describe, it, expect } from 'vitest';
import { readInt, parseTimeValue, readTime } from '$lib/server/params';

describe('readInt', () => {
	it('returns default value when param is missing or empty', () => {
		const u1 = new URL('http://localhost/api');
		expect(readInt(u1, 'limit', { def: 10 })).toEqual({ ok: true, value: 10 });

		const u2 = new URL('http://localhost/api?limit=');
		expect(readInt(u2, 'limit', { def: 20 })).toEqual({ ok: true, value: 20 });
	});

	it('parses valid integers', () => {
		const url = new URL('http://localhost/api?limit=42');
		expect(readInt(url, 'limit')).toEqual({ ok: true, value: 42 });
	});

	it('clamps integers within min and max', () => {
		const u1 = new URL('http://localhost/api?limit=500');
		expect(readInt(u1, 'limit', { max: 100 })).toEqual({ ok: true, value: 100 });

		const u2 = new URL('http://localhost/api?limit=-10');
		expect(readInt(u2, 'limit', { min: 1 })).toEqual({ ok: true, value: 1 });
	});

	it('rejects floating-point numbers', () => {
		const url = new URL('http://localhost/api?limit=12.34');
		const res = readInt(url, 'limit');
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toBe('`limit` must be an integer');
		}
	});

	it('rejects non-numeric strings', () => {
		const url = new URL('http://localhost/api?limit=abc');
		const res = readInt(url, 'limit');
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toBe('`limit` must be an integer');
		}
	});
});

describe('parseTimeValue', () => {
	const invalid = { ok: false, error: 'x must be an epoch-ms number or ISO-8601 date' };
	const seconds = {
		ok: false,
		error: 'x looks like epoch seconds (10 digits); send epoch-ms or an ISO-8601 date'
	};

	it('rejects non-time inputs, including whitespace-only strings', () => {
		expect(parseTimeValue(null, 'x')).toEqual(invalid);
		expect(parseTimeValue(undefined, 'x')).toEqual(invalid);
		expect(parseTimeValue('   ', 'x')).toEqual(invalid);
		expect(parseTimeValue(true, 'x')).toEqual(invalid);
		expect(parseTimeValue('invalid-date', 'x')).toEqual(invalid);
	});

	it('takes integer numbers as epoch-ms, including 0', () => {
		expect(parseTimeValue(1700000000000, 'x')).toEqual({ ok: true, value: 1700000000000 });
		expect(parseTimeValue(0, 'x')).toEqual({ ok: true, value: 0 });
	});

	it('rejects non-integer numbers', () => {
		expect(parseTimeValue(1700000000000.5, 'x')).toEqual(invalid);
		expect(parseTimeValue(NaN, 'x')).toEqual(invalid);
		expect(parseTimeValue(Infinity, 'x')).toEqual(invalid);
	});

	it('parses ISO-8601 date strings', () => {
		const iso = '2024-01-01T00:00:00.000Z';
		expect(parseTimeValue(iso, 'x')).toEqual({ ok: true, value: Date.parse(iso) });
	});

	it('reads digits-only strings with 12 or more digits as epoch-ms', () => {
		expect(parseTimeValue('1700000000000', 'x')).toEqual({ ok: true, value: 1700000000000 });
		expect(parseTimeValue(' 100000000000 ', 'x')).toEqual({ ok: true, value: 100000000000 });
	});

	it('reads a 4-digit string as Jan 1 of that year, UTC (R3)', () => {
		expect(parseTimeValue('2024', 'x')).toEqual({ ok: true, value: Date.UTC(2024, 0, 1) });
	});

	it('rejects 10-digit epoch seconds, as a string or a number', () => {
		expect(parseTimeValue('1700000000', 'x')).toEqual(seconds);
		expect(parseTimeValue(1700000000, 'x')).toEqual(seconds);
	});

	it('rejects digit strings that Date.parse would turn into nonsense years', () => {
		for (const s of ['0', '12', '99999', '20240101', '12345678901']) {
			expect(parseTimeValue(s, 'x')).toEqual(invalid);
		}
	});
});

describe('readTime', () => {
	it('returns undefined when param is missing or empty', () => {
		const u1 = new URL('http://localhost/api');
		expect(readTime(u1, 'since')).toEqual({ ok: true, value: undefined });

		const u2 = new URL('http://localhost/api?since=');
		expect(readTime(u2, 'since')).toEqual({ ok: true, value: undefined });
	});

	it('reads valid ISO time query param', () => {
		const iso = '2024-06-01T12:00:00Z';
		const url = new URL(`http://localhost/api?since=${encodeURIComponent(iso)}`);
		expect(readTime(url, 'since')).toEqual({ ok: true, value: Date.parse(iso) });
	});

	it('returns error result on invalid time query param', () => {
		const url = new URL('http://localhost/api?since=not-a-time');
		const res = readTime(url, 'since');
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toBe('`since` must be an epoch-ms number or ISO-8601 date');
		}
	});

	it('names the param when rejecting epoch seconds', () => {
		const url = new URL('http://localhost/api?until=1700000000');
		expect(readTime(url, 'until')).toEqual({
			ok: false,
			error: '`until` looks like epoch seconds (10 digits); send epoch-ms or an ISO-8601 date'
		});
	});
});
