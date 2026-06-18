<script lang="ts">
	import { base } from '$app/paths';
	import { scan } from '$lib/scan.svelte';
	import { fmtInt, fmtDate, statusColor, SEV_VAR } from '$lib/format';
	import SeverityPills from '$lib/components/SeverityPills.svelte';
	import type { Severity } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const o = $derived(data.overview);
	const totals = $derived(o.totals);

	// ----- live active run -----
	// SSR / first paint render the server snapshot; once the store hydrates it is
	// the single source of truth, so a run that ends while the page is open clears
	// instead of lingering as stale `data.scan`. (Header pill already keys off the
	// store directly — this keeps the overview card consistent with it.)
	const live = $derived(scan.hydrated ? scan.state : data.scan);
	const elapsedLabel = $derived(
		scan.hydrated && scan.state.active ? scan.elapsedLabel : '0:00'
	);

	// ----- severity bar segments -----
	function pct(n: number) {
		return totals.total ? (n / totals.total) * 100 : 0;
	}

	// ----- trend sparkline -----
	const trend = $derived(o.trend);
	const tmax = $derived(Math.max(1, ...trend.map((t) => t.count)));
	const trendPoints = $derived(
		trend
			.map((t, i) => {
				const x = (i / (trend.length - 1)) * 100;
				const y = 30 - (t.count / tmax) * 26 - 2;
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ')
	);
	const trendArea = $derived(`0,32 ${trendPoints} 100,32`);
	const wow = $derived.by(() => {
		const last = trend.slice(7).reduce((a, t) => a + t.count, 0);
		const prior = trend.slice(0, 7).reduce((a, t) => a + t.count, 0);
		if (!prior) return null;
		const d = Math.round(((last - prior) / prior) * 100);
		return { d, up: d > 0 };
	});

	// ----- repo list filtering -----
	let q = $state('');
	let fStatus = $state<'all' | 'flagged' | 'clean'>('all');
	let fSev = $state<'all' | Severity>('all');

	const filtered = $derived.by(() => {
		let list = o.repos;
		if (fStatus !== 'all') list = list.filter((r) => r.status === fStatus);
		if (fSev !== 'all') list = list.filter((r) => r.counts[fSev as Severity] > 0);
		const term = q.trim().toLowerCase();
		if (term)
			list = list.filter(
				(r) =>
					r.id.toLowerCase().includes(term) ||
					r.lang.toLowerCase().includes(term) ||
					r.description.toLowerCase().includes(term)
			);
		return list;
	});

	const statusOptions: { key: 'all' | 'flagged' | 'clean'; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'flagged', label: 'Flagged' },
		{ key: 'clean', label: 'Clean' }
	];
	const sevOptions: { key: 'all' | Severity; label: string; dot: string | null }[] = [
		{ key: 'all', label: 'Any severity', dot: null },
		{ key: 'crit', label: 'Critical', dot: SEV_VAR.crit },
		{ key: 'high', label: 'High', dot: SEV_VAR.high },
		{ key: 'med', label: 'Medium', dot: SEV_VAR.med },
		{ key: 'low', label: 'Low', dot: SEV_VAR.low }
	];

	function clearFilters() {
		q = '';
		fStatus = 'all';
		fSev = 'all';
	}
</script>

<svelte:head><title>Hermes · Security Overview</title></svelte:head>

<main>
	<div class="title-row">
		<div>
			<div class="eyebrow mono">Security Overview · Metric Grid</div>
			<h1 class="display">Repository Review Status</h1>
			<p class="lede">
				Hermes scans <strong>{o.reposCount}</strong>
				{o.orgLabel} repositories · last run {o.lastRunLabel}
			</p>
		</div>
	</div>

	<!-- totals + severity tiles -->
	<div class="grid-top">
		<div class="card big">
			<div class="big-head">
				<div class="muted">Open findings across all repos</div>
				<div class="mono faint">{totals.total} tracked</div>
			</div>
			<div class="big-num-row">
				<div class="big-num display">{totals.total}</div>
				<div class="crit-note">
					<span class="cdot"></span>{totals.crit} critical need attention
				</div>
			</div>
			<div class="sevbar">
				<div style="width:{pct(totals.crit)}%;background:var(--crit)"></div>
				<div style="width:{pct(totals.high)}%;background:var(--high)"></div>
				<div style="width:{pct(totals.med)}%;background:var(--med)"></div>
				<div style="width:{pct(totals.low)}%;background:var(--low)"></div>
			</div>
			<div class="legend mono">
				<span style="color:var(--crit)">● Critical {totals.crit}</span>
				<span style="color:var(--high)">● High {totals.high}</span>
				<span style="color:var(--med)">● Medium {totals.med}</span>
				<span style="color:var(--low)">● Low {totals.low}</span>
			</div>
		</div>

		<div class="tiles">
			<div class="card tile" style="--accent-top:var(--crit)">
				<div class="muted">Critical</div>
				<div class="tile-num display">{totals.crit}</div>
			</div>
			<div class="card tile" style="--accent-top:var(--high)">
				<div class="muted">High</div>
				<div class="tile-num display">{totals.high}</div>
			</div>
			<div class="card tile" style="--accent-top:var(--med)">
				<div class="muted">Medium</div>
				<div class="tile-num display">{totals.med}</div>
			</div>
			<div class="card tile" style="--accent-top:var(--low)">
				<div class="muted">Low</div>
				<div class="tile-num display">{totals.low}</div>
			</div>
		</div>
	</div>

	<!-- run strip -->
	<div class="run-strip">
		<div class="card run">
			<div class="klabel mono">Last run</div>
			<div class="run-big display">{o.lastRunLabel}</div>
			<div class="muted sm">{o.reposCount} repos scanned</div>
		</div>
		<div class="card run active">
			<div class="run-overlay"></div>
			<div class="run-inner">
				<div class="active-head">
					<span class="scan-dot"></span>
					<span class="mono">Active run · {elapsedLabel}</span>
				</div>
				{#if live.active && live.repoId}
					<a class="run-repo display" href="{base}/repo/{live.repoId}">{live.repoId}</a>
					<div class="run-file mono">scanning {live.currentFile ?? '…'}</div>
					<div class="pbar"><div class="pfill" style="width:{live.progress}%"></div></div>
				{:else}
					<div class="run-repo display">idle</div>
					<div class="run-file mono">no scan in progress</div>
					<div class="pbar"><div class="pfill" style="width:0%"></div></div>
				{/if}
			</div>
		</div>
		<div class="card run">
			<div class="klabel mono">Next run</div>
			<div class="run-big display">{o.nextRunLabel}</div>
			<div class="muted sm">{o.nextRunAt ? fmtDate(o.nextRunAt) : '—'}</div>
		</div>
	</div>

	<!-- trend + stats -->
	<div class="trend-row">
		<div class="card">
			<div class="trend-head">
				<div class="muted">New findings · 14 days</div>
				{#if wow}
					<div class="mono" style="color:var(--accent)">
						{wow.up ? '▴' : '▾'}
						{Math.abs(wow.d)}% wk/wk
					</div>
				{/if}
			</div>
			<svg viewBox="0 0 100 32" preserveAspectRatio="none" class="spark">
				<polygon points={trendArea} fill="var(--accentB)"></polygon>
				<polyline
					points={trendPoints}
					fill="none"
					stroke="var(--accent)"
					stroke-width="1.4"
					vector-effect="non-scaling-stroke"
				></polyline>
			</svg>
		</div>
		<div class="card stat">
			<div class="muted">Avg scan duration</div>
			<div class="stat-num display">{o.avgScanLabel}</div>
		</div>
		<div class="card stat">
			<div class="muted">Reviews all-time</div>
			<div class="stat-num display">{fmtInt(o.reviewsAllTime)}</div>
		</div>
	</div>

	<!-- filter bar -->
	<div class="filter-bar">
		<div class="filter-title">
			<h2 class="display">Repositories</h2>
			<span class="mono faint">{filtered.length} of {o.reposCount}</span>
		</div>
		<div class="filter-controls">
			<div class="search">
				<span class="faint">⌕</span>
				<input class="mono" placeholder="Search repos…" bind:value={q} />
			</div>
			<div class="chips">
				{#each statusOptions as s (s.key)}
					<button class="chip mono" class:on={fStatus === s.key} onclick={() => (fStatus = s.key)}>
						{s.label}
					</button>
				{/each}
			</div>
		</div>
	</div>
	<div class="chips sev-chips">
		{#each sevOptions as s (s.key)}
			<button class="chip mono" class:on={fSev === s.key} onclick={() => (fSev = s.key)}>
				{#if s.dot}<span class="chip-dot" style="background:{s.dot}"></span>{/if}{s.label}
			</button>
		{/each}
	</div>

	<!-- repo table -->
	<div class="table card">
		<div class="thead mono">
			<div>Repository</div>
			<div>Status</div>
			<div>Findings</div>
			<div>Last scan</div>
			<div></div>
		</div>
		{#if filtered.length === 0}
			<div class="empty">
				<div class="mono muted">No repositories match these filters</div>
				<button class="mono clear" onclick={clearFilters}>Clear filters</button>
			</div>
		{:else}
			{#each filtered as r (r.id)}
				<a class="trow" href="{base}/repo/{r.id}">
					<div class="cell-repo">
						<span class="lang-dot" style="background:{r.langColor}"></span>
						<div class="repo-text">
							<div class="repo-id mono">{r.id}</div>
							<div class="repo-desc">{r.description}</div>
						</div>
					</div>
					<div class="cell-status" style="color:{statusColor(r.counts)}">
						<span class="sdot" style="background:{statusColor(r.counts)}"></span>{r.statusLabel}
					</div>
					<div class="cell-find">
						<SeverityPills counts={r.counts} cleanLabel="✓ all clear" />
					</div>
					<div class="cell-scan mono">{r.lastRunLabel}</div>
					<div class="cell-chev">›</div>
				</a>
			{/each}
		{/if}
	</div>
</main>

<style>
	main {
		max-width: 1340px;
		margin: 0 auto;
		padding: 30px 26px;
	}
	.title-row {
		margin-bottom: 26px;
	}
	.eyebrow {
		font-size: 11px;
		letter-spacing: 0.16em;
		color: var(--accent);
		text-transform: uppercase;
		margin-bottom: 9px;
	}
	h1 {
		margin: 0;
		font-weight: 700;
		font-size: 30px;
		letter-spacing: -0.01em;
		color: var(--text);
	}
	.lede {
		margin: 8px 0 0;
		color: var(--dim);
		font-size: 14px;
	}
	.lede strong {
		color: var(--text);
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
	}
	.muted {
		font-size: 13px;
		color: var(--dim);
	}
	.faint {
		color: var(--faint);
	}
	.sm {
		font-size: 12px;
		margin-top: 4px;
	}

	.grid-top {
		display: grid;
		grid-template-columns: 1.4fr 1fr;
		gap: 16px;
		margin-bottom: 16px;
	}
	.big {
		padding: 22px;
		border-radius: 16px;
	}
	.big-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 18px;
	}
	.big-num-row {
		display: flex;
		align-items: flex-end;
		gap: 18px;
		margin-bottom: 20px;
	}
	.big-num {
		font-weight: 700;
		font-size: 62px;
		line-height: 0.9;
		color: var(--text);
	}
	.crit-note {
		padding-bottom: 7px;
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--crit);
		font-size: 13px;
		font-weight: 600;
	}
	.cdot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--crit);
	}
	.sevbar {
		display: flex;
		height: 14px;
		border-radius: 7px;
		overflow: hidden;
		background: var(--surface2);
	}
	.legend {
		display: flex;
		gap: 20px;
		margin-top: 14px;
		font-size: 12px;
		flex-wrap: wrap;
	}

	.tiles {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.tile {
		padding: 16px;
		border-top: 2px solid var(--accent-top);
	}
	.tile-num {
		font-weight: 700;
		font-size: 34px;
		color: var(--text);
	}

	.run-strip {
		display: grid;
		grid-template-columns: 1fr 1.3fr 1fr;
		gap: 16px;
		margin-bottom: 16px;
	}
	.run {
		padding: 18px;
	}
	.klabel {
		font-size: 10px;
		letter-spacing: 0.14em;
		color: var(--faint);
		text-transform: uppercase;
		margin-bottom: 10px;
	}
	.run-big {
		font-weight: 600;
		font-size: 20px;
		color: var(--text);
	}
	.run.active {
		border-color: var(--accent);
		position: relative;
		overflow: hidden;
	}
	.run-overlay {
		position: absolute;
		inset: 0;
		background: var(--accentB);
	}
	.run-inner {
		position: relative;
	}
	.active-head {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-bottom: 10px;
		font-size: 10px;
		letter-spacing: 0.14em;
		color: var(--accent);
		text-transform: uppercase;
	}
	.scan-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		animation: hpulse 1.6s infinite;
	}
	.run-repo {
		font-weight: 600;
		font-size: 18px;
		color: var(--text);
		display: inline-block;
	}
	a.run-repo:hover {
		color: var(--accent);
	}
	.run-file {
		font-size: 11px;
		color: var(--dim);
		margin: 7px 0 9px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pbar {
		height: 6px;
		border-radius: 3px;
		background: var(--surface2);
		overflow: hidden;
	}
	.pfill {
		height: 100%;
		background: var(--accent);
		transition: width 1s linear;
	}

	.trend-row {
		display: grid;
		grid-template-columns: 1.6fr 1fr 1fr;
		gap: 16px;
		margin-bottom: 22px;
	}
	.trend-row .card {
		padding: 18px;
	}
	.trend-head {
		display: flex;
		justify-content: space-between;
		margin-bottom: 14px;
		font-size: 12px;
	}
	.spark {
		width: 100%;
		height: 64px;
		display: block;
	}
	.stat {
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	.stat-num {
		font-weight: 700;
		font-size: 28px;
		color: var(--text);
		margin-top: 2px;
	}

	.filter-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
		flex-wrap: wrap;
	}
	.filter-title {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.filter-title h2 {
		margin: 0;
		font-weight: 600;
		font-size: 19px;
		color: var(--text);
	}
	.filter-controls {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 9px;
	}
	.search input {
		border: none;
		outline: none;
		background: transparent;
		color: var(--text);
		font-size: 13px;
		width: 148px;
	}
	.chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.sev-chips {
		margin-bottom: 14px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.01em;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--dim);
		transition: all 0.15s;
	}
	.chip:hover {
		border-color: var(--border2);
	}
	.chip.on {
		border-color: var(--accent);
		background: var(--accentB);
		color: var(--accent);
	}
	.chip-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.table {
		border-radius: 16px;
		overflow: hidden;
	}
	.thead,
	.trow {
		display: grid;
		grid-template-columns: 2.4fr 1fr 1.6fr 1.1fr 32px;
		gap: 14px;
		align-items: center;
	}
	.thead {
		padding: 13px 22px;
		border-bottom: 1px solid var(--border);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.trow {
		padding: 15px 22px;
		border-bottom: 1px solid var(--border);
		cursor: pointer;
		transition: background 0.12s;
	}
	.trow:last-child {
		border-bottom: none;
	}
	.trow:hover {
		background: var(--hover);
	}
	.cell-repo {
		display: flex;
		align-items: center;
		gap: 11px;
		min-width: 0;
	}
	.lang-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	.repo-text {
		min-width: 0;
	}
	.repo-id {
		font-weight: 600;
		font-size: 14px;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.repo-desc {
		font-size: 12px;
		color: var(--faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cell-status {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
	}
	.sdot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.cell-scan {
		font-size: 13px;
		color: var(--dim);
	}
	.cell-chev {
		color: var(--faint);
		font-size: 18px;
		text-align: right;
	}
	.empty {
		padding: 46px 22px;
		text-align: center;
	}
	.clear {
		margin-top: 12px;
		padding: 7px 14px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--accent);
		font-size: 12px;
		cursor: pointer;
	}

	@media (max-width: 900px) {
		.grid-top,
		.run-strip,
		.trend-row {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 720px) {
		.thead {
			display: none;
		}
		.trow {
			grid-template-columns: 1fr auto;
			grid-template-areas: 'repo chev' 'status status' 'find find' 'scan scan';
			gap: 8px;
		}
		.cell-repo {
			grid-area: repo;
		}
		.cell-status {
			grid-area: status;
		}
		.cell-find {
			grid-area: find;
		}
		.cell-scan {
			grid-area: scan;
		}
		.cell-chev {
			grid-area: chev;
		}
	}
</style>
