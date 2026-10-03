import { describe, it, expect } from 'vitest';
import { fingerprint } from '$lib/server/fingerprint';
import { canonicalFindings, contentHash } from '$lib/server/content-hash';

describe('fingerprint', () => {
	it('generates deterministic 16-character hex hash', () => {
		const fp = fingerprint('src/auth.ts', 'SQL Injection');
		expect(fp).toHaveLength(16);
		expect(fp).toMatch(/^[0-9a-f]{16}$/);
		expect(fingerprint('src/auth.ts', 'SQL Injection')).toBe(fp);
	});

	it('normalizes whitespace and case', () => {
		const fp1 = fingerprint('  src/auth.ts  ', 'SQL INJECTION  ');
		const fp2 = fingerprint('src/AUTH.ts', 'sql injection');
		expect(fp1).toBe(fp2);
	});

	it('produces distinct fingerprints for distinct files or titles', () => {
		const fp1 = fingerprint('src/a.ts', 'Bug');
		const fp2 = fingerprint('src/b.ts', 'Bug');
		const fp3 = fingerprint('src/a.ts', 'Feature');
		expect(fp1).not.toBe(fp2);
		expect(fp1).not.toBe(fp3);
	});
});

describe('canonicalFindings', () => {
	it('drops unknown severities', () => {
		const raw = [
			{ severity: 'crit', file: 'a.ts', title: 'Critical issue' },
			{ severity: 'info', file: 'b.ts', title: 'Informational note' },
			{ severity: 'warning', file: 'c.ts', title: 'Warning note' },
			{ severity: 'low', file: 'd.ts', title: 'Low issue' }
		];
		const res = canonicalFindings(raw);
		expect(res).toHaveLength(2);
		expect(res.map((f) => f.title)).toEqual(['Critical issue', 'Low issue']);
	});

	it('collapses same-fingerprint findings to the most severe', () => {
		const raw = [
			{ severity: 'low', file: 'a.ts', title: 'Bug' },
			{ severity: 'crit', file: 'a.ts', title: 'Bug' },
			{ severity: 'med', file: 'a.ts', title: 'Bug' }
		];
		const res = canonicalFindings(raw);
		expect(res).toHaveLength(1);
		expect(res[0].severity).toBe('crit');
	});

	it('preserves the first seen when severities tie', () => {
		const raw = [
			{ severity: 'high', file: 'a.ts', title: 'Bug', line: 10 },
			{ severity: 'high', file: 'a.ts', title: 'Bug', line: 20 }
		];
		const res = canonicalFindings(raw);
		expect(res).toHaveLength(1);
		expect(res[0].line).toBe(10);
	});

	// KNOWN-WRONG (E1, fixed by T16): two findings with same file+title collapse into one
	it('collapses distinct findings with same file and title (KNOWN-WRONG: E1)', () => {
		// In reality, line 15 and line 85 are different vulnerabilities, but today
		// fingerprinting only considers file + title, so the second is dropped.
		const raw = [
			{ severity: 'high', file: 'contracts/Vault.sol', title: 'Reentrancy', line: 15 },
			{ severity: 'high', file: 'contracts/Vault.sol', title: 'Reentrancy', line: 85 }
		];
		const res = canonicalFindings(raw);
		expect(res).toHaveLength(1);
		expect(res[0].line).toBe(15);
	});
});

describe('contentHash', () => {
	it('is deterministic and independent of finding order', () => {
		const h1 = contentHash({
			commit: 'c1',
			model: 'gpt-4o',
			engine: 'hermes',
			findings: [
				{ severity: 'low', file: 'b.ts', title: 'Low issue' },
				{ severity: 'crit', file: 'a.ts', title: 'Crit issue' }
			]
		});
		const h2 = contentHash({
			commit: 'c1',
			model: 'gpt-4o',
			engine: 'hermes',
			findings: [
				{ severity: 'crit', file: 'a.ts', title: 'Crit issue' },
				{ severity: 'low', file: 'b.ts', title: 'Low issue' }
			]
		});
		expect(h1).toHaveLength(64);
		expect(h1).toBe(h2);
	});

	it('trims whitespace on commit, model, and engine', () => {
		const h1 = contentHash({
			commit: ' c1 ',
			model: ' gpt-4o ',
			engine: ' hermes ',
			findings: []
		});
		const h2 = contentHash({
			commit: 'c1',
			model: 'gpt-4o',
			engine: 'hermes',
			findings: []
		});
		expect(h1).toBe(h2);
	});

	it('changes when commit, model, engine, or finding set changes', () => {
		const base = {
			commit: 'c1',
			model: 'gpt-4o',
			engine: 'hermes',
			findings: [{ severity: 'high', file: 'a.ts', title: 'Bug' }]
		};
		const baseHash = contentHash(base);

		expect(contentHash({ ...base, commit: 'c2' })).not.toBe(baseHash);
		expect(contentHash({ ...base, model: 'claude-3-5' })).not.toBe(baseHash);
		expect(contentHash({ ...base, engine: 'other' })).not.toBe(baseHash);
		expect(
			contentHash({
				...base,
				findings: [{ severity: 'med', file: 'a.ts', title: 'Bug' }]
			})
		).not.toBe(baseHash);
	});

	it('ignores prose differences in findings', () => {
		const h1 = contentHash({
			commit: 'c1',
			model: 'm1',
			engine: 'e1',
			findings: [{ severity: 'high', file: 'a.ts', title: 'Bug' }]
		});
		const h2 = contentHash({
			commit: 'c1',
			model: 'm1',
			engine: 'e1',
			findings: [
				{
					severity: 'high',
					file: 'a.ts',
					title: 'Bug',
					// extra untracked fields do not affect contentHash
					description: 'Detailed description'
				} as { severity: string; file: string; title: string }
			]
		});
		expect(h1).toBe(h2);
	});
});
