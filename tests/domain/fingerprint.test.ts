import { describe, it, expect } from 'vitest';
import { canonicalFindings, fingerprint, issueIdentity } from '$lib/server/fingerprint';
import { contentHash } from '$lib/server/content-hash';

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

describe('issueIdentity', () => {
	it('is the legacy file+title fingerprint when no ruleId is sent, even with a locationKey', () => {
		expect(issueIdentity({ file: 'contracts/Vault.sol', title: 'Reentrancy' })).toBe(
			fingerprint('contracts/Vault.sol', 'Reentrancy')
		);
		expect(
			issueIdentity({ file: 'contracts/Vault.sol', title: 'Reentrancy', locationKey: 'withdraw' })
		).toBe(fingerprint('contracts/Vault.sol', 'Reentrancy'));
		// A blank ruleId is no ruleId.
		expect(issueIdentity({ file: 'a.sol', title: 'Bug', ruleId: '  ' })).toBe(fingerprint('a.sol', 'Bug'));
	});

	it('pins the legacy fingerprint bytes that stored rows and triage tags carry', () => {
		// Value produced by the pre-identity release for this file + title.
		expect(fingerprint('contracts/Vault.sol', 'Reentrancy')).toBe('4422f9aac335689e');
	});

	it('with a ruleId, ignores the title so a rephrased finding keeps its identity', () => {
		const a = issueIdentity({
			ruleId: 'reentrancy-eth',
			file: 'contracts/Vault.sol',
			locationKey: 'Vault.withdraw',
			title: 'Reentrancy in withdraw()'
		});
		const b = issueIdentity({
			ruleId: 'reentrancy-eth',
			file: 'contracts/Vault.sol',
			locationKey: 'Vault.withdraw',
			title: 'State written after external call in withdraw'
		});
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{16}$/);
		expect(a).not.toBe(fingerprint('contracts/Vault.sol', 'Reentrancy in withdraw()'));
	});

	it('with a ruleId, separates locations, files and rules', () => {
		const base = { ruleId: 'reentrancy-eth', file: 'Vault.sol', locationKey: 'withdraw', title: 'R' };
		const id = issueIdentity(base);
		expect(issueIdentity({ ...base, locationKey: 'claim' })).not.toBe(id);
		expect(issueIdentity({ ...base, locationKey: '' })).not.toBe(id);
		expect(issueIdentity({ ...base, file: 'Token.sol' })).not.toBe(id);
		expect(issueIdentity({ ...base, ruleId: 'reentrancy-no-eth' })).not.toBe(id);
	});

	it('normalizes case and surrounding whitespace of every component', () => {
		expect(
			issueIdentity({ ruleId: ' Reentrancy-ETH ', file: 'VAULT.sol ', locationKey: ' Withdraw', title: 'x' })
		).toBe(issueIdentity({ ruleId: 'reentrancy-eth', file: 'vault.sol', locationKey: 'withdraw', title: 'y' }));
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

	it('collapses exact duplicates (same identity and line) to the most severe', () => {
		const raw = [
			{ severity: 'low', file: 'a.ts', title: 'Bug' },
			{ severity: 'crit', file: 'a.ts', title: 'Bug' },
			{ severity: 'med', file: 'a.ts', title: 'Bug' }
		];
		const res = canonicalFindings(raw);
		expect(res).toHaveLength(1);
		expect(res[0].severity).toBe('crit');
	});

	it('keeps the first of exact duplicates when severities tie', () => {
		const raw = [
			{ severity: 'high', file: 'a.ts', title: 'Bug', line: 10, description: 'first' },
			{ severity: 'high', file: 'a.ts', title: 'Bug', line: 10, description: 'second' }
		];
		const res = canonicalFindings(raw);
		expect(res).toHaveLength(1);
		expect(res[0].description).toBe('first');
	});

	it('keeps every location of an issue (E1: same file and title, different lines)', () => {
		const raw = [
			{ severity: 'high', file: 'contracts/Vault.sol', title: 'Reentrancy', line: 15 },
			{ severity: 'high', file: 'contracts/Vault.sol', title: 'Reentrancy', line: 85 }
		];
		const res = canonicalFindings(raw);
		expect(res.map((f) => f.line)).toEqual([15, 85]);
	});

	it('keeps same-line findings in different functions', () => {
		const raw = [
			{ severity: 'high', file: 'Vault.sol', title: 'Unchecked call', locationKey: 'withdraw' },
			{ severity: 'high', file: 'Vault.sol', title: 'Unchecked call', locationKey: 'claim' }
		];
		expect(canonicalFindings(raw)).toHaveLength(2);
	});
});

describe('contentHash', () => {
	it('is byte-identical to the pre-identity release for payloads without the new fields', () => {
		// Both hashes were computed by the release before agent-supplied identity existed.
		// The first payload exercises a same-file+title pair (collapsing to its worst
		// severity), a finding without a file, and a dropped unknown severity.
		// Rows as the agent sends them: `line` is part of the payload but not of the hash.
		const findings = [
			{ severity: 'high', file: 'contracts/Vault.sol', title: 'Reentrancy', line: 88 },
			{ severity: 'crit', file: 'contracts/Vault.sol', title: 'Reentrancy', line: 140 },
			{ severity: 'low', title: 'No file finding' },
			{ severity: 'info', file: 'x.sol', title: 'dropped' },
			{ severity: 'med', file: 'contracts/Token.sol', title: 'Overflow' }
		];
		expect(
			contentHash({ commit: 'a3f9c21', model: 'claude-opus-4-8', engine: 'slither+semgrep+llm', findings })
		).toBe('33e32a82c6eb97338338f4215427fd2a561bd38b069449581b42bc68075ddfb4');
		expect(contentHash({ commit: 'c0ffee', model: '', engine: '', findings: [] })).toBe(
			'2301b1b82454e66dd188d7a0280049487fa1c9c8fb571bf8e664f5ac9b4c5566'
		);
	});

	it('keys a finding with a ruleId on ruleId + file + locationKey, not on title or line', () => {
		const scan = (title: string, line: number, locationKey: string) => {
			const finding = { severity: 'high', ruleId: 'reentrancy-eth', file: 'Vault.sol', locationKey, title, line };
			return contentHash({ commit: 'c1', model: 'm', engine: 'e', findings: [finding] });
		};
		const base = scan('Reentrancy in withdraw()', 88, 'withdraw');
		expect(scan('State written after call', 95, 'withdraw')).toBe(base);
		expect(scan('Reentrancy in withdraw()', 88, 'claim')).not.toBe(base);
		expect(
			contentHash({
				commit: 'c1',
				model: 'm',
				engine: 'e',
				findings: [{ severity: 'high', file: 'Vault.sol', title: 'Reentrancy in withdraw()' }]
			})
		).not.toBe(base);
	});

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
