<script lang="ts">
	import { base } from '$app/paths';
	import type { RepoSummary } from '$lib/types';
	import SeverityPills from './SeverityPills.svelte';
	import Time from './Time.svelte';

	let { repos }: { repos: RepoSummary[] } = $props();
	const urgent = $derived(repos.filter((repo) => repo.counts.crit + repo.counts.high > 0));
</script>

<section class="attention" aria-labelledby="attention-title">
	<div class="section-head">
		<h2 class="display" id="attention-title">Needs attention</h2>
		<span class="mono">{urgent.length} {urgent.length === 1 ? 'repository' : 'repositories'}</span>
	</div>
	{#if urgent.length}
		<ul>
			{#each urgent as repo (repo.id)}
				<li>
					<a class="repo-id mono" href="{base}/repo/{repo.id}">{repo.id}</a>
					<SeverityPills counts={{ crit: repo.counts.crit, high: repo.counts.high, med: 0, low: 0, total: repo.counts.crit + repo.counts.high }} />
					{#if repo.oldestOpenAt !== null}
						<span class="age mono">Oldest <Time ts={repo.oldestOpenAt} mode="ago" /></span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">No open critical or high findings.</p>
	{/if}
</section>

<style>
	.attention { margin-top: 18px; }
	.section-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 9px; }
	h2 { margin: 0; font-size: 17px; font-weight: 600; }
	.section-head span { font-size: 11px; color: var(--faint); }
	ul { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 0; margin: 0; list-style: none; }
	li { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; padding: 10px 12px; border-left: 2px solid var(--border2); background: var(--surface); border-radius: 0 8px 8px 0; min-width: 0; }
	.repo-id { width: 100%; font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
	.repo-id:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
	.age { color: var(--dim); font-size: 10px; }
	.empty { margin: 0; color: var(--dim); font-size: 13px; }
	@media (max-width: 1000px) { ul { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 600px) { ul { grid-template-columns: 1fr; } }
</style>
