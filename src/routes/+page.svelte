<script lang="ts">
	import { scan } from '$lib/scan.svelte';
	import { SEVERITIES, SEV_LABEL, SEV_VAR } from '$lib/format';
	import SeverityStrip from '$lib/components/SeverityStrip.svelte';
	import NeedsAttention from '$lib/components/NeedsAttention.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import RepoTable from '$lib/components/RepoTable.svelte';
	import type { Severity } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const overview = $derived(data.overview);
	// SSR uses the server snapshot; after hydration the polling store owns scan state.
	const live = $derived(scan.hydrated ? scan.state : data.scan);
	const elapsedLabel = $derived(scan.hydrated && scan.state.active ? scan.elapsedLabel : '0:00');

	let query = $state('');
	let status = $state<'all' | 'flagged' | 'clean'>('all');
	let severity = $state<'all' | Severity>('all');
	const filtered = $derived.by(() => {
		const term = query.trim().toLowerCase();
		return overview.repos.filter((repo) =>
			(status === 'all' || repo.status === status) &&
			(severity === 'all' || repo.counts[severity] > 0) &&
			(!term || [repo.id, repo.lang, repo.description].some((value) => value.toLowerCase().includes(term)))
		);
	});
	const statusOptions = [
		{ key: 'all', label: 'All' },
		{ key: 'flagged', label: 'Flagged' },
		{ key: 'clean', label: 'Clean' }
	] as const;

	function clearFilters() {
		query = '';
		status = 'all';
		severity = 'all';
	}
</script>

<svelte:head><title>Hermes · Security Overview</title></svelte:head>

<main>
	<div class="title-row">
		<h1 class="display">Repository Review Status</h1>
		<p>Security overview · {overview.reposCount} {data.orgLabel} repositories</p>
	</div>

	<SeverityStrip counts={overview.totals} quietedCount={overview.quietedTotal} />
	<NeedsAttention repos={overview.repos} />
	<StatusBar lastRunAt={overview.lastRunAt} nextRunAt={overview.nextRunAt} avgScanSecs={overview.avgScanSecs} scanState={live} {elapsedLabel} />

	<section aria-labelledby="repositories-title">
		<div class="filter-bar">
			<div class="filter-title">
				<h2 class="display" id="repositories-title">Repositories</h2>
				<span class="mono faint">{filtered.length} of {overview.reposCount}</span>
			</div>
			<div class="filter-controls">
				<div class="search">
					<label for="repo-search" class="visually-hidden">Search repositories</label>
					<span class="faint" aria-hidden="true">⌕</span>
					<input id="repo-search" class="mono" placeholder="Search repos…" bind:value={query} />
				</div>
				<div class="chips" role="group" aria-label="Filter by status">
					{#each statusOptions as option (option.key)}
						<button class="chip mono" class:on={status === option.key} aria-pressed={status === option.key} onclick={() => (status = option.key)}>{option.label}</button>
					{/each}
				</div>
			</div>
		</div>
		<div class="chips sev-chips" role="group" aria-label="Filter by severity">
			<button class="chip mono" class:on={severity === 'all'} aria-pressed={severity === 'all'} onclick={() => (severity = 'all')}>Any severity</button>
			{#each SEVERITIES as key (key)}
				<button class="chip mono" class:on={severity === key} aria-pressed={severity === key} onclick={() => (severity = key)}>
					<span class="chip-dot" style="background:{SEV_VAR[key]}" aria-hidden="true"></span>{SEV_LABEL[key]}
				</button>
			{/each}
		</div>
		<RepoTable repos={filtered} onclearfilters={clearFilters} />
	</section>
</main>

<style>
	main { padding-top: 22px; padding-bottom: 30px; }
	.title-row { margin-bottom: 18px; }
	h1 { margin: 0; font-size: 27px; font-weight: 700; letter-spacing: -.01em; }
	.title-row p { margin: 6px 0 0; font-size: 13px; color: var(--dim); }
	.filter-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
	.filter-title { display: flex; align-items: baseline; gap: 10px; }
	h2 { margin: 0; font-size: 18px; font-weight: 600; }
	.filter-title span { font-size: 11px; }
	.faint { color: var(--faint); }
	.filter-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
	.search { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
	.search:focus-within { border-color: var(--accent); outline: 2px solid var(--accent); outline-offset: 2px; }
	.search input { width: 148px; padding: 0; border: 0; outline: none; background: transparent; color: var(--text); font-size: 12px; }
	.chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.sev-chips { margin-bottom: 12px; }
	.chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--dim); font-size: 11px; font-weight: 600; cursor: pointer; }
	.chip:hover { border-color: var(--border2); }
	.chip.on { border-color: var(--accent); background: var(--accentB); color: var(--accent); }
	.chip-dot { width: 6px; height: 6px; border-radius: 50%; }
	@media (max-width: 600px) {
		h1 { font-size: 23px; }
		.filter-controls { width: 100%; }
		.search { width: 100%; }
		.search input { width: 100%; min-width: 0; }
	}
</style>
