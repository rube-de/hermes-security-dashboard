<script lang="ts">
	import { base } from '$app/paths';
	import { SEVERITIES, SEV_LABEL, statusColor } from '$lib/format';
	import { compareRepos, type RepoSortColumn, type RepoSortDirection } from '$lib/repo-sort';
	import type { RepoSummary } from '$lib/types';
	import SeverityPills from './SeverityPills.svelte';
	import Time from './Time.svelte';

	let { repos, onclearfilters }: { repos: RepoSummary[]; onclearfilters: () => void } = $props();
	let sortColumn = $state<RepoSortColumn>('risk');
	let sortDirection = $state<RepoSortDirection>('descending');
	const sorted = $derived([...repos].sort((a, b) => compareRepos(a, b, sortColumn, sortDirection)));
	const columns: { key: RepoSortColumn; label: string; hint: string }[] = [
		{ key: 'repository', label: 'Repository', hint: 'Sort by repository name' },
		{ key: 'risk', label: 'Risk', hint: 'Sort by worst severity, critical and high count, then oldest open issue' },
		{ key: 'findings', label: 'Findings', hint: 'Sort by total open findings' },
		{ key: 'oldest', label: 'Oldest open', hint: 'Sort by the age of the oldest open critical or high issue' }
	];

	function sortBy(column: RepoSortColumn) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'descending' ? 'ascending' : 'descending';
		} else {
			sortColumn = column;
			sortDirection = column === 'repository' ? 'ascending' : 'descending';
		}
	}
</script>

<div class="table-wrap">
	<table>
		<caption class="visually-hidden">Repositories. Risk sorts by worst severity, critical and high count, then age of the oldest open issue. Oldest open includes critical and high issues only.</caption>
		<thead>
			<tr>
				{#each columns as column (column.key)}
					<th scope="col" aria-sort={sortColumn === column.key ? sortDirection : 'none'}>
						<button class="mono" onclick={() => sortBy(column.key)} title={column.hint}>
							{column.label}<span aria-hidden="true">{sortColumn === column.key ? (sortDirection === 'descending' ? '↓' : '↑') : '↕'}</span>
						</button>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if sorted.length === 0}
				<tr class="empty-row"><td colspan="4" class="empty">
					<p>No repositories match these filters</p>
					<button class="clear mono" onclick={onclearfilters}>Clear filters</button>
				</td></tr>
			{:else}
				{#each sorted as repo (repo.id)}
					{@const severity = SEVERITIES.find((key) => repo.counts[key] > 0)}
					<tr>
						<td class="repo-cell">
							<div class="repo-head">
								<a class="repo-id mono" href="{base}/repo/{repo.id}">{repo.id}</a>
								<span class="lang-tag mono">{repo.lang}</span>
							</div>
							<div class="repo-desc" title={repo.description}>{repo.description}</div>
						</td>
						<td class="risk-cell" style="color:{statusColor(repo.counts)}">
							{severity ? SEV_LABEL[severity] : 'Clean'}
						</td>
						<td class="findings-cell">
							<SeverityPills counts={repo.counts} cleanLabel="All clear" />
							{#if repo.quietedCount}<span class="triaged mono">{repo.quietedCount} triaged</span>{/if}
						</td>
						<td class="oldest-cell mono">
							{#if repo.oldestOpenAt !== null}<Time ts={repo.oldestOpenAt} mode="ago" />{:else}<span aria-label="No open critical or high issues">—</span>{/if}
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<style>
	.table-wrap { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
	table { border-collapse: collapse; width: 100%; table-layout: fixed; }
	th, td { text-align: left; padding: 12px 16px; }
	th { border-bottom: 1px solid var(--border); font-weight: 500; }
	th:first-child { width: 43%; }
	th:nth-child(2) { width: 12%; }
	th:nth-child(3) { width: 28%; }
	th:last-child { width: 17%; }
	th button { display: block; width: 100%; min-height: 28px; padding: 2px 0; background: none; border: none; color: var(--faint); cursor: pointer; font-size: 11px; text-align: left; }
	th button:hover { color: var(--text); }
	th[aria-sort='ascending'] button, th[aria-sort='descending'] button { color: var(--text); }
	th span { margin-left: 4px; color: var(--faint); }
	tbody tr { border-bottom: 1px solid var(--border); }
	tbody tr:last-child { border-bottom: none; }
	tbody tr:hover { background: var(--hover); }
	.repo-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
	.repo-id { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
	.repo-id:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
	.lang-tag { color: var(--faint); background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: 10px; }
	.repo-desc { color: var(--faint); font-size: 12px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.risk-cell { font-size: 12px; font-weight: 600; }
	.oldest-cell { font-size: 12px; color: var(--dim); }
	.triaged { display: inline-block; margin-top: 3px; color: var(--faint); font-size: 10px; }
	.empty { text-align: center; padding: 28px 16px; font-size: 13px; color: var(--dim); }
	.empty p { margin: 0 0 12px; }
	.clear { cursor: pointer; padding: 7px 12px; border: 1px solid var(--border2); border-radius: 7px; color: var(--accent); background: transparent; }
	@media (max-width: 700px) {
		th, td { padding: 12px 7px; }
		th:first-child { width: 40%; }
		th:nth-child(2) { width: 17%; }
		th:nth-child(3) { width: 26%; }
		th:last-child { width: 17%; }
		th button { font-size: 10px; }
		.repo-id { font-size: 11px; }
		.repo-desc { display: none; }
		.risk-cell, .oldest-cell { font-size: 10px; }
	}
</style>
