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
	it('returns null for null, undefined, empty, or whitespace', () => {
		expect(parseTimeValue(null)).toBeNull();
		expect(parseTimeValue(undefined)).toBeNull();
		expect(parseTimeValue('')).toBeNull();
		expect(parseTimeValue('   ')).toBeNull();
	});

	it('returns finite numbers as-is', () => {
		expect(parseTimeValue(1700000000000)).toBe(1700000000000);
		expect(parseTimeValue(NaN)).toBeNull();
		expect(parseTimeValue(Infinity)).toBeNull();
	});

	it('parses ISO-8601 date strings', () => {
		const iso = '2024-01-01T00:00:00.000Z';
		const expected = Date.parse(iso);
		expect(parseTimeValue(iso)).toBe(expected);
	});

	// KNOWN-WRONG (R3, fixed by T06): ?since=2024 is parsed as epoch ms
	it('parses digits-only strings as epoch-ms number directly (KNOWN-WRONG: R3)', () => {
		// "2024" is parsed as Number("2024") = 2024 ms after epoch, not Jan 1 2024.
		expect(parseTimeValue('2024')).toBe(2024);

		// 10-digit epoch seconds string "1700000000" is also treated as 1700000000 ms (1970).
		expect(parseTimeValue('1700000000')).toBe(1700000000);
	});

	it('returns null for invalid date strings', () => {
		expect(parseTimeValue('invalid-date')).toBeNull();
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
});
