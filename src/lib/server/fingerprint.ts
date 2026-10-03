import { createHash } from 'node:crypto';
import { SEVERITIES } from '$lib/format';

/** The finding fields identity is computed from. */
export interface IdentityFields {
	title: string;
	file?: string | null;
	ruleId?: string | null;
	locationKey?: string | null;
}

/** Severities, most severe first, typed as plain strings so raw input can be looked up. */
export const SEVERITY_ORDER: readonly string[] = SEVERITIES;

const normalize = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Legacy identity: sha1 of the normalized file path + title. Every finding stored before
 * agent-supplied identity existed carries this value, and so does every triage tag set on
 * one, so it must never change.
 */
export function fingerprint(file: string, title: string): string {
	const norm = `${file.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
	return createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

/**
 * Stable per-repo identity of the issue a finding reports: the key of the
 * new/carried/resolved diff, the commit union, the counts and triage (stored in the
 * `fingerprint` column).
 *
 * - With an agent-supplied `ruleId`, identity is `ruleId + file + locationKey`. The title
 *   is left out, so an LLM rephrasing it between runs keeps the identity, and so do
 *   line shifts. An empty `locationKey` is allowed: the same rule firing twice in a file
 *   without a symbol is then one issue with two locations, never a dropped finding.
 * - Without `ruleId` there is no stable notion of *which* check fired, so identity stays
 *   the legacy `fingerprint(file, title)`, byte-identical to earlier releases: old rows and
 *   triage tags keep matching with no re-keying. A `locationKey` sent without a `ruleId`
 *   is display-only.
 *
 * Components are trimmed and lower-cased, like the legacy key. The tuple is JSON-encoded
 * (unambiguous field boundaries) under an upper-case tag: legacy inputs are lower-cased,
 * so the two input spaces can never coincide.
 */
export function issueIdentity(f: IdentityFields): string {
	const ruleId = normalize(f.ruleId);
	if (!ruleId) return fingerprint(f.file ?? '', f.title);
	const tuple = JSON.stringify(['RULE', ruleId, normalize(f.file), normalize(f.locationKey)]);
	return createHash('sha1').update(tuple).digest('hex').slice(0, 16);
}

/**
 * The finding set a review stores: drop unknown severities, then collapse exact
 * duplicates only (the same issue identity reported at the same place: line +
 * locationKey) to the most severe report; ties keep the first. Distinct locations of
 * one issue are all kept; they render as one issue with several locations.
 */
export function canonicalFindings<
	T extends IdentityFields & { severity: string; line?: number | null }
>(findings: T[]): T[] {
	const byPlace = new Map<string, { f: T; rank: number }>();
	for (const f of findings) {
		const rank = SEVERITY_ORDER.indexOf(f.severity);
		if (rank < 0) continue;
		const place = JSON.stringify([issueIdentity(f), f.line ?? 0, normalize(f.locationKey)]);
		const ex = byPlace.get(place);
		if (!ex || rank < ex.rank) byPlace.set(place, { f, rank });
	}
	return [...byPlace.values()].map((e) => e.f);
}
