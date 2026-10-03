<script lang="ts">
	import { base } from '$app/paths';
	import { scan } from '$lib/scan.svelte';
	import { fmtDur, langColor } from '$lib/format';
	import CommitHistory from '$lib/components/CommitHistory.svelte';
	import Time from '$lib/components/Time.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const repo = $derived(data.repo);

	// SSR uses the server snapshot; the live store is authoritative once hydrated,
	// so a run that ends while this page is open clears the banner immediately.
	const scanning = $derived(
		scan.hydrated ? scan.state.active && scan.state.repoId === repo.id : repo.scanning
	);
	const live = $derived(scan.hydrated ? scan.state : data.scan);
	const elapsedLabel = $derived(
		scan.hydrated && scan.state.active && scan.state.repoId === repo.id
			? scan.elapsedLabel
			: '0:00'
	);


</script>

<svelte:head><title>Hermes · {repo.id}</title></svelte:head>

<main>
	<a class="back mono" href="{base}/">← All repositories</a>

	<div class="head">
		<div class="head-left">
			<div class="repo-icon"><span class="lang-dot" style="background:{langColor(repo.lang)}"></span></div>
			<div>
				<h1 class="display">{repo.id}</h1>
				<div class="meta mono">
					<span>{repo.path}</span><span class="dot">·</span><span>{repo.lang}</span>
					<span class="dot">·</span><span>⎇ {repo.branch}</span>
				</div>
				<div class="desc">{repo.description}</div>
			</div>
		</div>

	</div>

	{#if scanning}
		<div class="scan-banner" role="status">
			<span class="scan-dot"></span>
			<div class="scan-text mono">
				Review in progress — <span class="dim">scanning {live.currentFile ?? '…'}</span>
			</div>
			<div class="pbar"><div class="pfill" style="width:{live.progress}%"></div></div>
			<span class="mono accent">{elapsedLabel}</span>
		</div>
	{/if}

	<div class="summary">
		<div class="card tile" style="--accent-top:var(--crit)">
			<div class="muted">Critical</div>
			<div class="tile-num display">{repo.counts.crit}</div>
		</div>
		<div class="card tile" style="--accent-top:var(--high)">
			<div class="muted">High</div>
			<div class="tile-num display">{repo.counts.high}</div>
		</div>
		<div class="card tile" style="--accent-top:var(--med)">
			<div class="muted">Medium</div>
			<div class="tile-num display">{repo.counts.med}</div>
		</div>
		<div class="card tile" style="--accent-top:var(--low)">
			<div class="muted">Low</div>
			<div class="tile-num display">{repo.counts.low}</div>
		</div>
		<div class="card meta-card">
			<div><div class="ml">Last scan</div><div class="mv mono">{#if repo.lastRunAt !== null}<Time ts={repo.lastRunAt} mode="ago" />{:else}never{/if}</div></div>
			<div><div class="ml">Duration</div><div class="mv mono">{repo.lastDurationSecs !== null ? fmtDur(repo.lastDurationSecs) : '—'}</div></div>
			<div><div class="ml">Lines</div><div class="mv mono">{repo.lines.toLocaleString('en-US')}</div></div>
			<div><div class="ml">Files</div><div class="mv mono">{repo.filesScanned}</div></div>
		</div>
	</div>


	{#if repo.quietedCount > 0}
		<p class="union-note mono">
			{repo.quietedCount} finding{repo.quietedCount > 1 ? 's' : ''} hidden from the counts above —
			triaged as false-positive or accepted-risk.
		</p>
	{/if}

	<CommitHistory repoId={repo.id} commits={repo.commits} />
</main>

<style>
	main {
		padding-top: 26px;
		padding-bottom: 26px;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: var(--dim);
		margin-bottom: 20px;
		transition: color 0.15s;
	}
	.back:hover {
		color: var(--accent);
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 24px;
	}
	.head-left {
		display: flex;
		gap: 16px;
		align-items: flex-start;
	}
	.repo-icon {
		width: 46px;
		height: 46px;
		border-radius: 12px;
		background: var(--surface2);
		border: 1px solid var(--border);
		display: grid;
		place-items: center;
		flex: none;
	}
	.lang-dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
	}
	h1 {
		margin: 0;
		font-weight: 700;
		font-size: 26px;
		color: var(--text);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 6px;
		font-size: 12px;
		color: var(--faint);
		flex-wrap: wrap;
	}
	.dot {
		color: var(--border2);
	}
	.desc {
		font-size: 14px;
		color: var(--dim);
		margin-top: 8px;
	}


	.scan-banner {
		display: flex;
		align-items: center;
		gap: 14px;
		background: var(--surface);
		border: 1px solid var(--accent);
		border-radius: 12px;
		padding: 14px 18px;
		margin-bottom: 16px;
	}
	.scan-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
		animation: hpulse 1.6s infinite;
		flex: none;
	}
	.scan-text {
		font-size: 13px;
		color: var(--text);
		flex: 1;
	}
	.dim {
		color: var(--dim);
	}
	.accent {
		color: var(--accent);
		font-size: 12px;
	}
	.pbar {
		width: 160px;
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

	.summary {
		display: grid;
		grid-template-columns: repeat(4, 1fr) 1.4fr;
		gap: 14px;
		margin-bottom: 14px;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
	}
	.tile {
		padding: 16px;
		border-top: 2px solid var(--accent-top);
	}
	.muted {
		font-size: 12px;
		color: var(--dim);
	}
	.tile-num {
		font-weight: 700;
		font-size: 30px;
		color: var(--text);
	}
	.meta-card {
		padding: 16px;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		align-content: center;
	}
	.ml {
		font-size: 11px;
		color: var(--faint);
	}
	.mv {
		font-size: 14px;
		color: var(--text);
	}

	.union-note {
		margin: 18px 0 0;
		font-size: 12px;
		color: var(--dim);
		line-height: 1.5;
	}

	@media (max-width: 820px) {
		.summary {
			grid-template-columns: 1fr 1fr;
		}
		.meta-card {
			grid-column: span 2;
		}
	}
	@media (max-width: 700px) {
		.head {
			flex-direction: column;
		}
	}
</style>
