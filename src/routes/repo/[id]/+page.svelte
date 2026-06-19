<script lang="ts">
	import { base } from '$app/paths';
	import { scan } from '$lib/scan.svelte';
	import SeverityPills from '$lib/components/SeverityPills.svelte';
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

	// ----- re-run request -----
	// The agent runs scans on a schedule; this records a user request for the next
	// cycle (the agent reads pending requests via GET /api/repos/:id/rerun).
	let rerun = $state<'idle' | 'pending' | 'queued' | 'error'>('idle');
	async function requestRerun() {
		if (rerun === 'pending' || rerun === 'queued') return;
		rerun = 'pending';
		try {
			const res = await fetch(`${base}/api/repos/${repo.id}/rerun`, { method: 'POST' });
			rerun = res.ok ? 'queued' : 'error';
		} catch {
			rerun = 'error';
		}
	}
</script>

<svelte:head><title>Hermes · {repo.id}</title></svelte:head>

<main>
	<a class="back mono" href="{base}/">← All repositories</a>

	<div class="head">
		<div class="head-left">
			<div class="repo-icon"><span class="lang-dot" style="background:{repo.langColor}"></span></div>
			<div>
				<h1 class="display">{repo.id}</h1>
				<div class="meta mono">
					<span>{repo.path}</span><span class="dot">·</span><span>{repo.lang}</span>
					<span class="dot">·</span><span>⎇ {repo.branch}</span>
				</div>
				<div class="desc">{repo.description}</div>
			</div>
		</div>
		<button
			class="rerun mono"
			onclick={requestRerun}
			disabled={rerun === 'pending' || rerun === 'queued'}
			aria-live="polite"
			title="Request a re-run on the next Hermes cycle"
		>
			{#if rerun === 'queued'}
				<span>✓</span> Re-run requested
			{:else if rerun === 'pending'}
				<span>↻</span> Requesting…
			{:else if rerun === 'error'}
				<span>⚠</span> Try again
			{:else}
				<span>↻</span> Re-run review
			{/if}
		</button>
	</div>

	{#if scanning}
		<div class="scan-banner">
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
			<div><div class="ml">Last scan</div><div class="mv mono">{repo.lastRunLabel}</div></div>
			<div><div class="ml">Duration</div><div class="mv mono">{repo.lastDurationLabel}</div></div>
			<div><div class="ml">Lines</div><div class="mv mono">{repo.lines.toLocaleString('en-US')}</div></div>
			<div><div class="ml">Files</div><div class="mv mono">{repo.filesScanned}</div></div>
		</div>
	</div>

	{#if repo.headScanCount > 1}
		<p class="union-note mono">
			Status above unions {repo.headScanCount} scans of <span class="commit">{repo.headCommit}</span> —
			a finding any scan flags is counted, so the headline can exceed an individual run below.
		</p>
	{/if}

	{#if repo.quietedCount > 0}
		<p class="union-note mono">
			{repo.quietedCount} finding{repo.quietedCount > 1 ? 's' : ''} hidden from the counts above —
			triaged as false-positive or accepted-risk.
		</p>
	{/if}

	<section class="history">
		<div class="hist-head">
			<h2 class="display">Review history</h2>
			<span class="mono faint">click a run to open the report</span>
		</div>
		<div class="table card">
			<div class="thead mono">
				<div>Date</div>
				<div>Commit</div>
				<div>Model</div>
				<div>Trigger</div>
				<div>Findings</div>
				<div>Duration</div>
				<div></div>
			</div>
			{#each repo.reviews as rv (rv.id)}
				<a class="rrow" href="{base}/repo/{repo.id}/review/{rv.id}">
					<div class="mono rdate">{rv.dateLabel}</div>
					<div class="mono rcommit">{rv.commit}</div>
					<div class="mono rmodel">{rv.model || '—'}</div>
					<div class="rtrigger">{rv.trigger}</div>
					<div class="rfind">
						<SeverityPills counts={rv.counts} cleanLabel="✓ clean" />
						{#if rv.hasDelta}
							<span class="delta mono">
								<span class="up">+{rv.newCount}</span>
								<span class="down">−{rv.resolvedCount}</span>
							</span>
						{/if}
					</div>
					<div class="mono rdur">{rv.durationLabel}</div>
					<div class="rchev">›</div>
				</a>
			{/each}
		</div>
	</section>
</main>

<style>
	main {
		max-width: 1180px;
		margin: 0 auto;
		padding: 26px;
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
	.rerun {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 9px 16px;
		border-radius: 10px;
		background: var(--accentB);
		border: 1px solid var(--accent);
		color: var(--accent);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.rerun:disabled {
		cursor: default;
		opacity: 0.7;
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
	.union-note .commit {
		color: var(--accent2);
	}
	.history {
		margin-top: 26px;
	}
	.hist-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 14px;
	}
	.hist-head h2 {
		margin: 0;
		font-weight: 600;
		font-size: 18px;
		color: var(--text);
	}
	.faint {
		color: var(--faint);
		font-size: 12px;
	}
	.table {
		border-radius: 16px;
		overflow: hidden;
	}
	.thead,
	.rrow {
		display: grid;
		grid-template-columns: 1.2fr 0.9fr 0.95fr 0.85fr 1.5fr 0.75fr 32px;
		gap: 14px;
		align-items: center;
	}
	.thead {
		padding: 12px 20px;
		border-bottom: 1px solid var(--border);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.rrow {
		padding: 15px 20px;
		border-bottom: 1px solid var(--border);
		cursor: pointer;
		transition: background 0.12s;
	}
	.rrow:last-child {
		border-bottom: none;
	}
	.rrow:hover {
		background: var(--hover);
	}
	.rdate {
		font-size: 13px;
		color: var(--text);
	}
	.rcommit {
		font-size: 13px;
		color: var(--accent2);
	}
	.rmodel {
		font-size: 12px;
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rtrigger {
		font-size: 12px;
		color: var(--dim);
	}
	.rfind {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
	}
	.delta {
		font-size: 11px;
		color: var(--faint);
		white-space: nowrap;
	}
	.delta .up {
		color: var(--high);
	}
	.delta .down {
		color: var(--accent);
	}
	.rdur {
		font-size: 13px;
		color: var(--dim);
	}
	.rchev {
		color: var(--faint);
		text-align: right;
		font-size: 16px;
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
		.thead {
			display: none;
		}
		.rrow {
			grid-template-columns: 1fr auto;
			grid-template-areas: 'date chev' 'commit commit' 'model model' 'find find' 'dur dur';
			gap: 6px;
		}
		.rdate {
			grid-area: date;
		}
		.rcommit {
			grid-area: commit;
		}
		.rmodel {
			grid-area: model;
		}
		.rtrigger {
			display: none;
		}
		.rfind {
			grid-area: find;
		}
		.rdur {
			grid-area: dur;
		}
		.rchev {
			grid-area: chev;
		}
	}
</style>
