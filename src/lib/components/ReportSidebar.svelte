<script lang="ts">
	import { SEVERITIES, SEV_LABEL, SEV_SHORT, SEV_VAR } from '$lib/format';
	import type { Finding, Severity, SeverityCounts } from '$lib/types';

	let {
		counts,
		findings,
		total,
		quietedCount,
		selectedSeverity,
		showTriaged,
		activeId,
		onSeverity,
		onShowTriaged,
		onPick
	}: {
		counts: SeverityCounts;
		findings: Finding[];
		total: number;
		quietedCount: number;
		selectedSeverity: Severity | 'all';
		showTriaged: boolean;
		activeId: string;
		onSeverity: (severity: Severity | 'all') => void;
		onShowTriaged: (show: boolean) => void;
		onPick: (fingerprint: string) => void;
	} = $props();

	let indexOpen = $state(false);

	function pick(event: MouseEvent, fingerprint: string) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		indexOpen = false;
		onPick(fingerprint);
	}
</script>

{#snippet findingIndex()}
	<ol class="index-list">
		{#each findings as finding (finding.fingerprint)}
			<li>
				<a
					href="#{finding.fingerprint}"
					aria-current={activeId === finding.fingerprint ? 'location' : undefined}
					onclick={(event) => pick(event, finding.fingerprint)}
				>
					<span class="index-severity mono" style="color:{SEV_VAR[finding.severity]}">
						<span aria-hidden="true">{SEV_SHORT[finding.severity]}</span>
						<span class="visually-hidden">{SEV_LABEL[finding.severity]}: </span>
					</span>
					<span>{finding.title}</span>
				</a>
			</li>
		{/each}
	</ol>
{/snippet}

<div class="sidebar">
	<h2 class="display">Navigate findings</h2>
	<div class="filters" role="group" aria-label="Filter findings by severity">
		<button
			type="button"
			class="all"
			class:selected={selectedSeverity === 'all'}
			aria-pressed={selectedSeverity === 'all'}
			aria-controls="report-findings"
			onclick={() => onSeverity('all')}
		>All <span class="count mono">{counts.total}</span></button>
		{#each SEVERITIES as severity (severity)}
			<button
				type="button"
				class:selected={selectedSeverity === severity}
				aria-label="{SEV_LABEL[severity]} ({counts[severity]})"
				aria-pressed={selectedSeverity === severity}
				aria-controls="report-findings"
				style="--severity:{SEV_VAR[severity]}"
				onclick={() => onSeverity(severity)}
			>
				<span class="full-label">{SEV_LABEL[severity]}</span>
				<span class="short-label" aria-hidden="true">{severity === 'crit' ? 'Crit' : severity === 'med' ? 'Med' : SEV_LABEL[severity]}</span>
				<span class="count mono">{counts[severity]}</span>
			</button>
		{/each}
	</div>
	<button
		type="button"
		class="show-triaged"
		aria-pressed={showTriaged}
		aria-controls="report-findings"
		aria-describedby="triaged-filter-help"
		onclick={() => onShowTriaged(!showTriaged)}
	>
		<span class="check" aria-hidden="true">{showTriaged ? '✓' : ''}</span>
		Show triaged <span class="mono">({quietedCount})</span>
	</button>
	<p class="filter-help" id="triaged-filter-help">False positives and accepted risks</p>
	<p class="showing mono" role="status">Showing {findings.length} of {total} findings</p>
	<nav class="desktop-index" aria-label="Findings index">
		<h3 class="mono">Findings index</h3>
		{@render findingIndex()}
	</nav>
	<details class="mobile-index" bind:open={indexOpen}>
		<summary class="mono">Findings index ({findings.length})</summary>
		<nav aria-label="Findings index">{@render findingIndex()}</nav>
	</details>
</div>

<style>
	.sidebar {
		padding: 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	h2 {
		margin: 0 0 14px;
		font-size: 16px;
		font-weight: 600;
	}
	.filters {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 7px;
	}
	.filters button {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 6px;
		padding: 9px;
		min-height: 36px;
		border: 1px solid var(--border2);
		border-radius: 6px;
		background: var(--surface);
		color: var(--dim);
		font-size: 12px;
		cursor: pointer;
	}
	.filters .all {
		grid-column: 1 / -1;
		--severity: var(--accent);
	}
	.filters button:hover {
		background: var(--hover);
	}
	.filters button.selected {
		border-color: var(--severity);
		color: var(--severity);
		background: var(--surface2);
	}
	.count {
		font-size: 11px;
	}
	.short-label {
		display: none;
	}
	.show-triaged {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 7px;
		margin-top: 14px;
		padding: 5px 0;
		background: transparent;
		color: var(--dim);
		border: none;
		border-radius: 3px;
		cursor: pointer;
		font-size: 12px;
	}
	.check {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border: 1px solid var(--border2);
		border-radius: 3px;
		color: var(--accent);
	}
	.show-triaged[aria-pressed='true'] .check {
		border-color: var(--accent);
		background: var(--accentB);
	}
	.filter-help {
		margin: 2px 0 0;
		color: var(--faint);
		font-size: 11px;
		line-height: 1.5;
	}
	.showing {
		margin: 14px 0;
		color: var(--faint);
		font-size: 10px;
	}
	h3 {
		margin: 0 0 10px;
		color: var(--faint);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-weight: 500;
	}
	.index-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
		list-style: none;
		padding: 0;
		margin: 0;
		max-height: calc(100dvh - 430px);
		overflow-y: auto;
	}
	.index-list a {
		display: flex;
		align-items: baseline;
		gap: 9px;
		padding: 8px 5px;
		border-radius: 4px;
		color: var(--dim);
		font-size: 12px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.index-list a:hover,
	.index-list a[aria-current='location'] {
		background: var(--hover);
		color: var(--text);
	}
	.index-severity {
		flex: none;
		font-size: 10px;
	}
	.mobile-index {
		display: none;
	}
	@media (max-width: 899px) {
		.sidebar {
			padding: 12px;
		}
		h2,
		.desktop-index,
		.full-label {
			display: none;
		}
		.short-label {
			display: inline;
		}
		.filters {
			grid-template-columns: repeat(5, minmax(0, 1fr));
			gap: 5px;
		}
		.filters .all {
			grid-column: auto;
		}
		.filters button {
			flex-wrap: wrap;
			justify-content: center;
			padding: 6px 4px;
			font-size: 11px;
			gap: 3px;
		}
		.show-triaged {
			margin-top: 7px;
		}
		.filter-help {
			font-size: 10px;
		}
		.showing {
			margin: 8px 0;
		}
		.mobile-index {
			display: block;
		}
		.mobile-index summary {
			cursor: pointer;
			font-size: 11px;
			color: var(--dim);
			border-radius: 3px;
		}
		.index-list {
			margin-top: 8px;
			max-height: 30dvh;
		}
	}
</style>
