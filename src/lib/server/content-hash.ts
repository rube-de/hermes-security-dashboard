import { createHash } from 'node:crypto';
import { fingerprint } from './fingerprint';
import { SEVERITIES, SEV_RANK } from '$lib/format';
import type { Severity } from '$lib/types';

/**
 * Content identity of a scan submission: the commit it ran against, the model and
 * engine that produced it, and the set of findings it surfaced.
 *
 * Two submissions with the same content hash are the *same scan result* — i.e. an
 * at-least-once delivery retry — and the review POST dedups them. Any meaningful
 * change yields a new hash and therefore a new review:
 *   - an extra/removed finding (a non-deterministic LLM re-run finding more or less)
 *   - a different `model` (two models scanning the same commit)
 *   - a severity change for an existing finding
 *
 * Volatile, derived fields (duration, summary prose, html body, timestamps) are
 * deliberately excluded — they don't change *what was found*, so a retry that
 * differs only in those still dedups.
 */
export interface ScanIdentity {
	commit: string;
	model: string;
	engine: string;
	findings: { severity: string; file?: string; title: string }[];
}

/** Severities the app recognises, as a fast lookup; derived from SEVERITIES so it
 *  can't drift. Findings outside this set are dropped from a scan's identity. */
const KNOWN_SEV: ReadonlySet<string> = new Set(SEVERITIES);

/**
 * Reduce a raw finding list to the canonical identity set: drop findings whose
 * severity isn't one the app knows, then collapse findings sharing a fingerprint
 * (same normalized file+title) to the single most-severe one (ties keep the first
 * seen). This is the one definition of "the finding set of a scan" — the live POST
 * path runs it before it BOTH stores and hashes a scan, and contentHash() runs it
 * again so a caller that hands over raw rows (the migration backfill of a legacy
 * row whose duplicates/odd severities were stored verbatim) still lands on the hash
 * a faithful resubmit produces, instead of inserting a twin.
 */
export function canonicalFindings<
	T extends { severity: string; file?: string | null; title: string }
>(findings: T[]): T[] {
	const byFp = new Map<string, T>();
	for (const f of findings) {
		if (!KNOWN_SEV.has(f.severity)) continue;
		const fp = fingerprint(f.file ?? '', f.title);
		const ex = byFp.get(fp);
		if (!ex || SEV_RANK[f.severity as Severity] < SEV_RANK[ex.severity as Severity])
			byFp.set(fp, f);
	}
	return [...byFp.values()];
}

export function contentHash(s: ScanIdentity): string {
	// canonicalFindings() drops unknown severities and collapses same-fingerprint
	// findings, so identity is independent of intra-scan duplicates. Then sort the
	// per-finding (severity, fingerprint) keys so the same set in any order hashes
	// identically; fingerprint() already normalizes file+title, so prose differences
	// in description/recommendation never affect the identity.
	const keys = canonicalFindings(s.findings)
		.map((f) => `${f.severity}:${fingerprint(f.file ?? '', f.title)}`)
		.sort();
	// Normalize commit/model/engine here so identity is the single source of truth:
	// the live POST path trims these, but a content_hash backfilled from a legacy
	// row reads the stored value verbatim (older writers didn't trim). Trimming at
	// the hash makes a post-upgrade retry of such a row dedup instead of inserting a
	// twin. Encode as a structured JSON tuple rather than a delimiter-joined string:
	// a raw separator (e.g. '\n') could appear inside an agent-controlled value and
	// let two distinct scans collide; JSON escaping keeps field boundaries
	// unambiguous regardless of field contents.
	const canonical = JSON.stringify([s.commit.trim(), s.model.trim(), s.engine.trim(), keys]);
	return createHash('sha256').update(canonical).digest('hex');
}
