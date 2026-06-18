/** Query-param parsing helpers for the read endpoints. Each returns a tagged
 *  result so the handler can emit a precise 400 on bad input. */

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
 * Coerce a value to epoch-ms: a finite number is taken as-is; a string is parsed
 * as epoch-ms or ISO-8601. Returns null for null/undefined/empty/invalid input.
 */
export function parseTimeValue(raw: unknown): number | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
	if (typeof raw !== 'string') return null;
	// Trim first: Number('   ') === 0, so a whitespace-only string would otherwise
	// parse as epoch 0 and (in the review route) silently clear the schedule.
	const s = raw.trim();
	if (s === '') return null;
	const n = Number(s);
	if (Number.isFinite(n)) return n;
	const t = Date.parse(s);
	return Number.isNaN(t) ? null : t;
}

/** Time query param: epoch-ms number or ISO-8601 string. Absent → undefined. */
export function readTime(url: URL, name: string): ParamResult<number | undefined> {
	const raw = url.searchParams.get(name);
	if (raw === null || raw === '') return { ok: true, value: undefined };
	const v = parseTimeValue(raw);
	if (v === null) {
		return { ok: false, error: `\`${name}\` must be an epoch-ms number or ISO-8601 date` };
	}
	return { ok: true, value: v };
}
