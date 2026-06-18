#!/usr/bin/env node
// Demo driver for the Hermes agent API. Mimics what the real agent does:
//   1. announces an active scan and streams progress to PUT /api/scan
//   2. submits the finished report to POST /api/repos/:id/reviews
//   3. clears the active scan
//
// Usage:
//   node scripts/simulate-scan.mjs [repoId]
// Env:
//   HERMES_URL    base url (default http://localhost:3000)
//   HERMES_API_TOKEN   sent as Bearer if set

const BASE = process.env.HERMES_URL || 'http://localhost:3000';
const TOKEN = process.env.HERMES_API_TOKEN;
const repoId = process.argv[2] || 'sapphire-paratime';

const headers = {
	'content-type': 'application/json',
	...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {})
};

const FILES = [
	'contracts/ConfidentialVault.sol',
	'contracts/PriceOracle.sol',
	'contracts/FeeManager.sol',
	'contracts/RewardDistributor.sol',
	'contracts/Lottery.sol'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function put(body) {
	const res = await fetch(`${BASE}/api/scan`, { method: 'PUT', headers, body: JSON.stringify(body) });
	if (!res.ok) throw new Error(`PUT /api/scan -> ${res.status} ${await res.text()}`);
}

async function main() {
	const startedAt = Date.now();
	console.log(`▶ scanning ${repoId} on ${BASE}`);

	for (let p = 0; p <= 100; p += 8) {
		await put({
			active: true,
			repoId,
			commit: 'a3f9c21',
			currentFile: FILES[Math.floor(p / 22) % FILES.length],
			progress: p,
			engine: 'slither+semgrep+llm',
			startedAt
		});
		process.stdout.write(`\r  progress ${p}%   `);
		await sleep(700);
	}
	console.log('\n  submitting report…');

	const review = {
		commit: 'a3f9c21',
		trigger: 'Scheduled',
		engine: 'slither+semgrep+llm',
		durationSecs: Math.round((Date.now() - startedAt) / 1000),
		lines: 19200,
		filesScanned: 80,
		// What the real agent knows from its own (flexible) schedule.
		nextRunAt: Date.now() + 6 * 3600 * 1000,
		findings: [
			{
				severity: 'crit',
				title: 'Reentrancy in withdraw() via external call before state update',
				file: 'contracts/ConfidentialVault.sol',
				line: 142,
				cwe: 'CWE-841',
				description: 'Balance state is updated after an external call to a user-controlled address.',
				code: '(bool ok,) = msg.sender.call{value: amt}("");\nbal[msg.sender] -= amt;',
				recommendation: 'Apply checks-effects-interactions or a nonReentrant guard.'
			},
			{
				severity: 'high',
				title: 'Missing access control on setOracle()',
				file: 'contracts/PriceOracle.sol',
				line: 88,
				cwe: 'CWE-284',
				description: 'Any account can repoint the price feed.',
				code: 'function setOracle(address o) external { oracle = o; }',
				recommendation: 'Restrict to owner/governance with onlyOwner.'
			}
		]
	};

	const res = await fetch(`${BASE}/api/repos/${repoId}/reviews`, {
		method: 'POST',
		headers,
		body: JSON.stringify(review)
	});
	const out = await res.json();
	if (!res.ok) throw new Error(`POST review -> ${res.status} ${JSON.stringify(out)}`);
	console.log('  report submitted:', out);

	await put({ active: false });
	console.log('✓ scan complete, active run cleared');
}

main().catch((e) => {
	console.error('\n✗', e.message);
	process.exit(1);
});
