<script lang="ts">
	import { base } from '$app/paths';
	import SeverityPills from './SeverityPills.svelte';
	import Time from './Time.svelte';
	import type { CommitGroup } from '$lib/types';

	let { repoId, commits }: { repoId: string; commits: CommitGroup[] } = $props();
	let expanded = $state<string[]>([]);

	function toggle(commit: string) {
		expanded = expanded.includes(commit)
			? expanded.filter((value) => value !== commit)
			: [...expanded, commit];
	}

	function scansId(commit: string) {
		return `commit-scans-${encodeURIComponent(repoId)}-${encodeURIComponent(commit)}`;
	}
</script>

<section class="history" aria-labelledby="history-heading">
	<div class="history-head">
		<h2 id="history-heading" class="display">Review history</h2>
	</div>
	{#if commits.length === 0}
		<p class="empty">No commits scanned yet.</p>
	{:else}
		<div class="history-table">
			<table>
				<caption class="visually-hidden">Commit review history for {repoId}</caption>
				<thead class="mono">
					<tr>
						<th scope="col">Date</th>
						<th scope="col">Commit / model</th>
						<th scope="col">Findings</th>
						<th scope="col">Change</th>
					</tr>
				</thead>
				{#each commits as group (group.commit)}
					{@const isExpanded = expanded.includes(group.commit)}
					{@const controlsId = scansId(group.commit)}
					<tbody class="commit-group">
						<tr class="commit-row">
							<td class="date mono"><Time ts={group.createdAt} /></td>
							<th scope="row" class="identity">
								{#if group.scans.length === 1}
									<a class="commit-link mono" href="{base}/repo/{repoId}/review/{group.scans[0].reviewId}">
										<span class="commit">{group.commit} <span class="chevron" aria-hidden="true">›</span></span>
										<span class="model">{group.scans[0].model || 'Unreported model'}</span>
									</a>
								{:else}
									<button
										type="button"
										class="disclosure mono"
										aria-label="{group.scans.length} scans for commit {group.commit}"
										aria-expanded={isExpanded}
										aria-controls={controlsId}
										onclick={() => toggle(group.commit)}
									>
										<span class="commit">{group.commit} <span class="chevron" aria-hidden="true">{isExpanded ? '⌄' : '›'}</span></span>
										<span class="model">{group.scans.length} scans</span>
									</button>
								{/if}
							</th>
							<td class="findings"><SeverityPills counts={group.counts} cleanLabel="✓ clean" /></td>
							<td class="change mono">
								{#if group.newCount > 0}<span class="new">+{group.newCount} new</span>{/if}
								{#if group.newCount > 0 && group.fixedCount > 0}<span class="separator"> · </span>{/if}
								{#if group.fixedCount > 0}<span class="fixed">{group.fixedCount} fixed</span>{/if}
							</td>
						</tr>
					</tbody>
					{#if group.scans.length > 1}
						<tbody id={controlsId} class="scan-group" hidden={!isExpanded}>
							{#each group.scans as scan (scan.reviewId)}
								<tr class="scan-row">
									<td class="date mono"><Time ts={scan.createdAt} /></td>
									<th scope="row" class="identity">
										<a class="scan-link mono" href="{base}/repo/{repoId}/review/{scan.reviewId}">
											{scan.model || 'Unreported model'}
											<span class="visually-hidden">report for commit {group.commit}</span>
											<span class="chevron" aria-hidden="true">›</span>
										</a>
									</th>
									<td class="findings"><SeverityPills counts={scan.counts} cleanLabel="✓ clean" /></td>
									<td class="change unique mono">{scan.uniqueCount} unique to {scan.model || 'unreported model'}</td>
								</tr>
							{/each}
						</tbody>
					{/if}
				{/each}
			</table>
		</div>
	{/if}
</section>

<style>
	.history {
		margin-top: 26px;
	}
	.history-head {
		margin-bottom: 14px;
	}
	h2 {
		margin: 0;
		font-weight: 600;
		font-size: 18px;
		color: var(--text);
	}
	.history-table {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		overflow: hidden;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		text-align: left;
	}
	thead th {
		padding: 12px 20px;
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--faint);
	}
	thead th:nth-child(1) {
		width: 23%;
	}
	thead th:nth-child(2) {
		width: 27%;
	}
	thead th:nth-child(3) {
		width: 27%;
	}
	thead th:nth-child(4) {
		width: 23%;
	}
	tbody th,
	tbody td {
		padding: 14px 20px;
		border-top: 1px solid var(--border);
		vertical-align: middle;
	}
	tbody th {
		font-weight: 400;
	}
	.commit-row:hover {
		background: var(--hover);
	}
	.date {
		font-size: 12px;
		color: var(--dim);
	}
	.commit-link,
	.disclosure {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 5px;
		max-width: 100%;
		padding: 4px 0;
		font-size: 13px;
		text-align: left;
	}
	.disclosure {
		border: none;
		background: none;
		cursor: pointer;
	}
	.commit {
		color: var(--accent2);
		overflow-wrap: anywhere;
	}
	.model {
		font-size: 11px;
		color: var(--dim);
		overflow-wrap: anywhere;
	}
	.chevron {
		color: var(--faint);
		margin-left: 6px;
		font-size: 16px;
	}
	.commit-link:hover .commit,
	.commit-link:focus-visible .commit,
	.disclosure:hover .commit,
	.disclosure:focus-visible .commit,
	.scan-link:hover,
	.scan-link:focus-visible {
		color: var(--accent);
	}
	.change {
		font-size: 12px;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.new {
		color: var(--high);
		white-space: nowrap;
	}
	.fixed {
		color: var(--accent);
		white-space: nowrap;
	}
	.separator {
		color: var(--faint);
	}
	.scan-group {
		background: var(--surface2);
	}
	.scan-group[hidden] {
		display: none;
	}
	.scan-row .identity {
		padding-left: 32px;
	}
	.scan-link {
		display: inline-block;
		padding: 4px 0;
		font-size: 12px;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.unique {
		color: var(--dim);
	}
	.empty {
		padding: 20px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		color: var(--dim);
		font-size: 14px;
	}
	@media (max-width: 700px) {
		thead {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
		}
		tr {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'identity change' 'date date' 'findings findings';
			gap: 8px 12px;
			padding: 14px 16px;
			border-top: 1px solid var(--border);
		}
		.commit-group:first-child .commit-row {
			border-top: none;
		}
		tbody th,
		tbody td {
			padding: 0;
			border: none;
		}
		.identity {
			grid-area: identity;
		}
		.date {
			grid-area: date;
		}
		.findings {
			grid-area: findings;
		}
		.change {
			grid-area: change;
			align-self: start;
			padding-top: 4px;
		}
		.scan-row {
			grid-template-areas: 'identity identity' 'date date' 'findings findings' 'change change';
			padding-left: 28px;
		}
		.scan-row .identity {
			padding-left: 0;
		}
	}
</style>
