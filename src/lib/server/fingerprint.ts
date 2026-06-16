import { createHash } from 'node:crypto';

/**
 * Stable identifier for a finding across reviews of the same repo.
 * Based on the normalized file path + title, so the same issue at the same
 * location is recognised run-over-run (powering new/carried/resolved diffs).
 */
export function fingerprint(file: string, title: string): string {
	const norm = `${file.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
	return createHash('sha1').update(norm).digest('hex').slice(0, 16);
}
