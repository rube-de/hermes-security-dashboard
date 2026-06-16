import { db } from './db';
import { addRepo, insertReview, setMeta, setScan, type FindingInput, type ReviewInput } from './store';
import type { Severity } from '$lib/types';

/**
 * One-time demo seed. Mirrors the Claude Design prototype: 10 real Oasis
 * Protocol repositories with realistic findings, plus a generated review
 * history so the diff/trend feature has genuine new/carried/resolved data.
 * No-op once any repo exists.
 */

interface RawFinding {
	sev: Severity;
	title: string;
	file: string;
	line: number;
	cwe: string;
	desc: string;
	rec: string;
	code: string;
}
interface RawRepo {
	id: string;
	lang: string;
	desc: string;
	findings: RawFinding[];
}

const RAW: RawRepo[] = [
	{ id: 'oasis-core', lang: 'Rust', desc: 'Core consensus, scheduler & runtime host', findings: [] },
	{
		id: 'oasis-sdk',
		lang: 'Go',
		desc: 'Runtime & client SDKs for ParaTimes',
		findings: [
			{ sev: 'high', title: 'Signing nonce may be reused under concurrency', file: 'client-sdk/go/crypto/signature/signer.go', line: 64, cwe: 'CWE-323', desc: 'A cached nonce can be reused across two concurrent signing calls under load, weakening signature security.', rec: 'Generate a fresh random nonce per signature inside the lock.', code: 'n := s.cachedNonce\nsig := sign(msg, s.key, n)' },
			{ sev: 'high', title: 'Cross-runtime message dispatched without origin check', file: 'runtime-sdk/src/dispatcher.rs', line: 210, cwe: 'CWE-20', desc: 'Inbound cross-runtime messages are dispatched without validating the source runtime id.', rec: 'Verify the runtime id against an allowlist before dispatch.', code: 'let call = decode(&msg.body)?;\ndispatch(call); // origin unverified' },
			{ sev: 'med', title: 'Raw RPC errors leak internal endpoints', file: 'client-sdk/go/connection/connection.go', line: 122, cwe: 'CWE-209', desc: 'Unwrapped RPC errors propagate to callers, leaking internal endpoint paths.', rec: 'Wrap and sanitize errors at the API boundary.', code: 'return nil, err // leaks endpoint path' }
		]
	},
	{
		id: 'sapphire-paratime',
		lang: 'Solidity',
		desc: 'Confidential EVM ParaTime',
		findings: [
			{ sev: 'crit', title: 'Reentrancy in withdraw() via external call before state update', file: 'contracts/ConfidentialVault.sol', line: 142, cwe: 'CWE-841', desc: 'Balance state is updated after an external call to a user-controlled address, letting a malicious contract re-enter withdraw() before the balance is decremented.', rec: 'Apply checks-effects-interactions or guard with a nonReentrant mutex; decrement before transferring.', code: 'function withdraw(uint256 amt) external {\n  require(bal[msg.sender] >= amt);\n  (bool ok,) = msg.sender.call{value: amt}("");\n  bal[msg.sender] -= amt;  // state change AFTER call\n}' },
			{ sev: 'high', title: 'Missing access control on setOracle()', file: 'contracts/PriceOracle.sol', line: 88, cwe: 'CWE-284', desc: 'setOracle() has no owner/governance restriction; any account can repoint the price feed.', rec: 'Restrict to the owner or governance role with onlyOwner.', code: 'function setOracle(address o) external {\n  oracle = o;  // no access control\n}' },
			{ sev: 'high', title: 'Fee multiplication can overflow in unchecked block', file: 'contracts/FeeManager.sol', line: 53, cwe: 'CWE-190', desc: 'Fee math runs inside an unchecked block and can overflow for large amounts.', rec: 'Remove the unchecked block or bound the input amount.', code: 'unchecked {\n  fee = amount * feeBps / 10_000;\n}' },
			{ sev: 'high', title: 'Unbounded loop enables gas-griefing DoS', file: 'contracts/RewardDistributor.sol', line: 201, cwe: 'CWE-834', desc: 'distribute() iterates an unbounded participant array, letting a griefer push gas past the block limit and freeze distribution.', rec: 'Switch to a pull-based claim pattern or paginate the loop.', code: 'for (uint i; i < holders.length; i++) {\n  _send(holders[i], share);\n}' },
			{ sev: 'med', title: 'Timestamp dependence in winner selection', file: 'contracts/Lottery.sol', line: 77, cwe: 'CWE-829', desc: 'block.timestamp is used as the randomness source for selecting a winner.', rec: 'Use a commit-reveal scheme or a verifiable random function.', code: 'uint winner = uint(block.timestamp) % players.length;' },
			{ sev: 'med', title: 'Floating compiler pragma', file: 'contracts/ConfidentialVault.sol', line: 1, cwe: 'CWE-1104', desc: 'Floating pragma ^0.8.0 may compile under an untested compiler version.', rec: 'Pin to a specific reviewed compiler version.', code: 'pragma solidity ^0.8.0;' },
			{ sev: 'low', title: 'Oracle updates emit no event', file: 'contracts/PriceOracle.sol', line: 95, cwe: 'CWE-778', desc: 'Oracle changes do not emit an event, hindering off-chain monitoring.', rec: 'Emit OracleUpdated(old, new) on change.', code: 'oracle = o;\n// no event emitted' }
		]
	},
	{ id: 'oasis-web3-gateway', lang: 'Go', desc: 'Web3-compatible JSON-RPC gateway', findings: [] },
	{
		id: 'emerald-paratime',
		lang: 'Go',
		desc: 'EVM-compatible production ParaTime',
		findings: [
			{ sev: 'med', title: 'Gas price read from manipulable tx field', file: 'precompiles/gas.go', line: 77, cwe: 'CWE-682', desc: 'A precompile reads gas price from an attacker-controlled transaction field.', rec: 'Use the block-level base fee instead.', code: 'price := tx.GasPrice() // attacker-set' },
			{ sev: 'low', title: 'Verbose request logging at info level', file: 'rpc/handler.go', line: 155, cwe: 'CWE-532', desc: 'Full request bodies are logged at info level, risking sensitive data exposure.', rec: 'Redact sensitive fields before logging.', code: 'log.Info("req", "body", string(raw))' },
			{ sev: 'low', title: 'No rate limiting on JSON-RPC endpoint', file: 'rpc/server.go', line: 44, cwe: 'CWE-770', desc: 'The public JSON-RPC endpoint has no per-IP rate limiting.', rec: 'Add a rate-limiting middleware.', code: '// no rate limiting middleware' }
		]
	},
	{
		id: 'oasis-wallet-web',
		lang: 'TypeScript',
		desc: 'Official browser wallet',
		findings: [
			{ sev: 'high', title: 'XSS via unsanitized dApp metadata', file: 'src/app/components/DappConnect.tsx', line: 140, cwe: 'CWE-79', desc: 'dApp-provided metadata is rendered with dangerouslySetInnerHTML.', rec: 'Render as text and validate icon URLs.', code: '<div dangerouslySetInnerHTML={{ __html: dapp.name }} />' },
			{ sev: 'med', title: 'Unencrypted key cached in localStorage', file: 'src/app/lib/persist.ts', line: 58, cwe: 'CWE-922', desc: 'An unlocked private key is cached in localStorage across sessions.', rec: 'Keep key material in memory only; never persist unencrypted.', code: "localStorage.setItem('pk', wallet.privateKey)" },
			{ sev: 'med', title: 'No Content-Security-Policy set', file: 'public/index.html', line: 12, cwe: 'CWE-1021', desc: 'The app ships without a CSP header or meta tag.', rec: 'Add a strict Content-Security-Policy.', code: '<!-- no CSP meta present -->' },
			{ sev: 'low', title: 'Outdated dependency with known advisory', file: 'package.json', line: 31, cwe: 'CWE-1104', desc: 'lodash 4.17.15 has known prototype-pollution advisories.', rec: 'Upgrade lodash to >= 4.17.21.', code: '"lodash": "4.17.15"' }
		]
	},
	{ id: 'deoxysii', lang: 'Rust', desc: 'Deoxys-II-256-128 AEAD implementation', findings: [] },
	{
		id: 'cipher-paratime',
		lang: 'Rust',
		desc: 'Confidential WASM smart-contract ParaTime',
		findings: [
			{ sev: 'crit', title: 'Uninitialized WASM buffer read discloses heap data', file: 'src/wasm/memory.rs', line: 188, cwe: 'CWE-908', desc: 'A linear-memory buffer is read before initialization, potentially disclosing residual heap data to the caller.', rec: 'Zero-initialize the buffer before its first read.', code: 'let mut buf = Vec::with_capacity(len);\nunsafe { buf.set_len(len); } // uninitialized read' },
			{ sev: 'med', title: 'Session seed derived from non-CSPRNG source', file: 'src/crypto/seed.rs', line: 41, cwe: 'CWE-338', desc: 'The session seed is derived from a timestamp rather than a cryptographic RNG.', rec: 'Use the platform CSPRNG (getrandom).', code: 'let seed = (ts as u64).wrapping_mul(2654435761);' }
		]
	},
	{
		id: 'nexus',
		lang: 'Go',
		desc: 'Indexer & analytics API',
		findings: [
			{ sev: 'med', title: 'SQL injection in search filter', file: 'analyzer/queries/search.go', line: 92, cwe: 'CWE-89', desc: 'A search filter is concatenated directly into a SQL query string.', rec: 'Use parameterized queries / prepared statements.', code: 'q := "SELECT * FROM txs WHERE addr=\'" + addr + "\'"' },
			{ sev: 'med', title: 'Unvalidated pagination parameters', file: 'api/handlers/list.go', line: 61, cwe: 'CWE-20', desc: 'limit/offset parameters are unvalidated, allowing huge result sets.', rec: 'Clamp limit to a sane maximum.', code: 'limit := atoi(r.URL.Query().Get("limit"))' },
			{ sev: 'med', title: 'Metrics endpoint exposed without auth', file: 'api/server.go', line: 130, cwe: 'CWE-306', desc: 'The /metrics endpoint is served without authentication.', rec: 'Require auth or bind to localhost only.', code: 'mux.Handle("/metrics", promhttp.Handler())' },
			{ sev: 'med', title: 'Race condition on shared cache map', file: 'cache/store.go', line: 88, cwe: 'CWE-362', desc: 'Concurrent map access without a lock can corrupt the cache.', rec: 'Guard access with a sync.RWMutex.', code: 'c.m[key] = val // concurrent write, no lock' },
			{ sev: 'low', title: 'TLS configuration permits TLS 1.0', file: 'api/tls.go', line: 22, cwe: 'CWE-326', desc: 'MinVersion allows the deprecated TLS 1.0 protocol.', rec: 'Set MinVersion to TLS 1.2 or higher.', code: 'MinVersion: tls.VersionTLS10' }
		]
	},
	{
		id: 'oasis-sdk-rust',
		lang: 'Rust',
		desc: 'Rust client bindings & codec',
		findings: [
			{ sev: 'high', title: 'Malformed CBOR triggers panic (remote DoS)', file: 'src/codec.rs', line: 73, cwe: 'CWE-248', desc: 'Decoding malformed CBOR calls unwrap() and panics, enabling a remote denial of service.', rec: 'Return a decode error instead of unwrapping.', code: 'let v: Value = cbor::from_slice(data).unwrap();' },
			{ sev: 'med', title: 'Unchecked u128 to u64 truncation', file: 'src/amount.rs', line: 39, cwe: 'CWE-197', desc: 'A u128 amount is cast to u64 without a checked conversion, silently truncating.', rec: 'Use try_into() and handle the overflow case.', code: 'let a = big_amount as u64; // truncates' }
		]
	}
];

// Findings resolved since the prior run (present before, fixed now).
const RESOLVED: Record<string, { sev: Severity; title: string; file: string; line: number }[]> = {
	'sapphire-paratime': [
		{ sev: 'high', title: 'Unchecked return value on token transfer', file: 'contracts/Treasury.sol', line: 64 },
		{ sev: 'med', title: 'Missing zero-address check in constructor', file: 'contracts/ConfidentialVault.sol', line: 22 }
	],
	'oasis-sdk': [{ sev: 'med', title: 'Hardcoded gateway URL in default config', file: 'client-sdk/go/config.go', line: 18 }],
	'cipher-paratime': [{ sev: 'high', title: 'Stack overflow on deeply nested CBOR input', file: 'src/wasm/exec.rs', line: 210 }],
	'oasis-wallet-web': [{ sev: 'low', title: 'Mixed-content asset request over HTTP', file: 'public/index.html', line: 40 }],
	nexus: [{ sev: 'med', title: 'Open redirect in explorer link handler', file: 'api/handlers/redirect.go', line: 31 }],
	'oasis-sdk-rust': [{ sev: 'med', title: 'Panic on empty input slice', file: 'src/codec.rs', line: 20 }]
};

// How many runs ago each finding (by position) was first detected.
const BORN = [2, 0, 3, 1, 0, 4, 2, 1, 3, 0];
const COMMITS = ['a3f9c21', '7e2b840', 'c14d0aa', '9fb37e5', '2d8a1c6', 'e60b94f', '4a7f3d2', 'b82c5e1', 'f019ac4', '5c3e7b8', 'd47a209', '81e6f3c'];

const HOUR = 3_600_000;

function toInput(f: RawFinding): FindingInput {
	return {
		severity: f.sev,
		title: f.title,
		file: f.file,
		line: f.line,
		cwe: f.cwe,
		description: f.desc,
		recommendation: f.rec,
		code: f.code
	};
}

function resolvedToInput(r: { sev: Severity; title: string; file: string; line: number }): FindingInput {
	return {
		severity: r.sev,
		title: r.title,
		file: r.file,
		line: r.line,
		cwe: '',
		description: 'Flagged by an earlier Hermes scan at this location.',
		recommendation: 'Resolved in a later run — retained here for historical context.',
		code: ''
	};
}

export function seedIfEmpty(): void {
	const existing = db.prepare('SELECT COUNT(*) AS n FROM repos').get() as { n: number };
	if (existing.n > 0) return;

	const now = Date.now();
	const base0 = now - (2 * HOUR + 14 * 60_000); // latest run ≈ "2h 14m ago"

	RAW.forEach((repo, seed) => {
		const lines = 7600 + seed * 2350;
		const filesScanned = 54 + seed * 13;
		const flagged = repo.findings.length > 0;
		const nReviews = flagged ? 8 : 6;
		const resolved = (RESOLVED[repo.id] ?? []).map(resolvedToInput);

		// created_at encodes RAW order so the repo list renders in a stable order.
		addRepo(
			{ id: repo.id, lang: repo.lang, description: repo.desc, path: `oasisprotocol/${repo.id}`, lines },
			base0 + seed * 1000
		);

		// Insert oldest -> newest so the diff engine sees each prior run.
		for (let k = nReviews - 1; k >= 0; k--) {
			const current = repo.findings.filter((_, p) => BORN[p % BORN.length] >= k).map(toInput);
			const findings = k >= 1 ? [...current, ...resolved] : current;
			const durationSecs = 165 + ((seed * 53 + k * 37) % 150);

			const review: ReviewInput = {
				commit: COMMITS[(seed + k) % COMMITS.length],
				trigger: k % 4 === 2 ? 'Push to main' : 'Scheduled',
				engine: 'slither+semgrep+llm',
				durationSecs,
				lines,
				filesScanned,
				createdAt: base0 - k * 6 * HOUR,
				findings
			};
			insertReview(repo.id, review);
		}
	});

	setMeta('cadence', 'Every 6 hours');
	setMeta('cadence_hours', '6');
	setMeta('org_label', 'Oasis Protocol');
	setMeta('accent', '#54E0BE');
	setMeta('next_run_at', String(base0 + 6 * HOUR));
	// All-time review count includes history predating this dashboard.
	setMeta('reviews_base', '1210');

	// A live scan in progress on sapphire-paratime (≈47s in, like the prototype).
	setScan({
		active: true,
		repoId: 'sapphire-paratime',
		commit: 'a3f9c21',
		currentFile: 'contracts/RewardDistributor.sol',
		progress: 41,
		engine: 'slither+semgrep+llm',
		startedAt: now - 47_000
	});
}
