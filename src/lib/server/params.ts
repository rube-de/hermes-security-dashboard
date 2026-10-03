/** Request input parsing helpers (query params, JSON bodies and their fields). Each
 *  returns a tagged result so the handler can emit a precise 400 on bad input. */

export type ParamResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Integer query param, optionally clamped. Absent → `def`. */
export function readInt(
	url: URL,
	name: string,
	{ min, max, def }: { min?: number; max?: number; def?: number } = {}
): ParamResult<number | undefined> {
	const raw = url.searchParams.get(name);
	if (raw === null || raw === '') return { ok: true, value: def };
	const n = Number(raw);
	if (!Number.isFinite(n) || !Number.isInteger(n)) {
		return { ok: false, error: `\`${name}\` must be an integer` };
	}
	let v = n;
	if (min !== undefined) v = Math.max(min, v);
	if (max !== undefined) v = Math.min(max, v);
	return { ok: true, value: v };
}

/**
 * Parse a time value to epoch-ms. `label` names the field in the error message.
 *
 * - A number must be an integer and is epoch-ms as-is (`0` included).
 * - A digits-only string with 12+ digits is epoch-ms; a 4-digit one is a year, read by
 *   `Date.parse` as Jan 1 UTC (`?since=2024`). Other digit counts are rejected:
 *   `Date.parse` turns them into nonsense years ("0" → 2000, "99999" → 99998).
 * - Any other string goes through `Date.parse` (ISO-8601).
 * - A 10-digit value is epoch *seconds*; read as epoch-ms it would land in January 1970,
 *   so it is rejected with an explicit error instead of being silently wrong.
 */
export function parseTimeValue(raw: unknown, label: string): ParamResult<number> {
	const invalid = {
		ok: false,
		error: `${label} must be an epoch-ms number or ISO-8601 date`
	} as const;
	const seconds = {
		ok: false,
		error: `${label} looks like epoch seconds (10 digits); send epoch-ms or an ISO-8601 date`
	} as const;

	if (typeof raw === 'number') {
		if (!Number.isInteger(raw)) return invalid;
		// 1e9 ≤ |n| < 1e10 is the magnitude of a present-day Unix time in seconds.
		const tenDigits = Math.abs(raw) >= 1e9 && Math.abs(raw) < 1e10;
		return tenDigits ? seconds : { ok: true, value: raw };
	}
	if (typeof raw !== 'string') return invalid;
	const s = raw.trim();
	if (/^\d+$/.test(s)) {
		if (s.length >= 12) return { ok: true, value: Number(s) };
		if (s.length === 10) return seconds;
		if (s.length !== 4) return invalid;
	}
	const t = Date.parse(s);
	return Number.isNaN(t) ? invalid : { ok: true, value: t };
}

/** Time query param: epoch-ms or ISO-8601 (see {@link parseTimeValue}). Absent → undefined. */
export function readTime(url: URL, name: string): ParamResult<number | undefined> {
	const raw = url.searchParams.get(name);
	if (raw === null || raw === '') return { ok: true, value: undefined };
	return parseTimeValue(raw, `\`${name}\``);
}

/** Request body that must be a JSON object. Malformed JSON, `null`, arrays and primitives
 *  are rejected here rather than crashing a handler that reads fields off them. */
export async function readJsonObject(
	request: Request
): Promise<ParamResult<Record<string, unknown>>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return { ok: false, error: 'invalid JSON body' };
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return { ok: false, error: 'JSON body must be an object' };
	}
	// Narrowed to a non-null, non-array object above; JSON objects have string keys only.
	const record = body as Record<string, unknown>;
	return { ok: true, value: record };
}

/**
 * Optional integer body field: `undefined`/`null` → undefined; otherwise it must be an
 * integer, and ≥ 0 unless `signed`. `label` names the field in the error message.
 */
export function intField(
	v: unknown,
	label: string,
	{ signed = false }: { signed?: boolean } = {}
): ParamResult<number | undefined> {
	if (v === undefined || v === null) return { ok: true, value: undefined };
	if (typeof v !== 'number' || !Number.isInteger(v) || (!signed && v < 0)) {
		return { ok: false, error: `${label} must be ${signed ? 'an' : 'a non-negative'} integer` };
	}
	return { ok: true, value: v };
}

/**
 * Optional string body field, trimmed: `undefined`/`null` → ''. Another type, or more
 * than `max` characters after trimming, is an error; values are never truncated, so an
 * over-long one is a visible client error rather than a silently altered value.
 */
export function stringField(v: unknown, label: string, max: number): ParamResult<string> {
	if (v === undefined || v === null) return { ok: true, value: '' };
	if (typeof v !== 'string') return { ok: false, error: `${label} must be a string` };
	const s = v.trim();
	if (s.length > max) {
		return { ok: false, error: `${label} must be at most ${max} characters` };
	}
	return { ok: true, value: s };
}
