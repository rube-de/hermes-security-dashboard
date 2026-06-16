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

/** Time query param: epoch-ms number or ISO-8601 string. Absent → undefined. */
export function readTime(url: URL, name: string): ParamResult<number | undefined> {
	const raw = url.searchParams.get(name);
	if (raw === null || raw === '') return { ok: true, value: undefined };
	const n = Number(raw);
	if (Number.isFinite(n)) return { ok: true, value: n };
	const t = Date.parse(raw);
	if (Number.isNaN(t)) {
		return { ok: false, error: `\`${name}\` must be an epoch-ms number or ISO-8601 date` };
	}
	return { ok: true, value: t };
}
