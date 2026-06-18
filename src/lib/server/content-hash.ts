import { createHash } from 'node:crypto';
import { fingerprint } from './fingerprint';

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

export function contentHash(s: ScanIdentity): string {
	// Order-independent: sort the per-finding (severity, fingerprint) keys so the
	// same finding set in any order hashes identically. fingerprint() already
	// normalizes file+title, so prose differences in description/recommendation
	// never affect the identity.
	const keys = s.findings
		.map((f) => `${f.severity}:${fingerprint(f.file ?? '', f.title)}`)
		.sort();
	// Encode as a structured JSON tuple rather than a delimiter-joined string: a
	// raw separator (e.g. '\n') could appear inside an agent-controlled model/engine
	// value and let two distinct scans collide. JSON escaping makes field boundaries
	// unambiguous regardless of field contents.
	const canonical = JSON.stringify([s.commit, s.model, s.engine, keys]);
	return createHash('sha256').update(canonical).digest('hex');
}
