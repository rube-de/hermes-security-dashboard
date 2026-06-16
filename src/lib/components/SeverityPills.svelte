<script lang="ts">
	import { sevPills } from '$lib/format';
	import type { SeverityCounts } from '$lib/types';

	let {
		counts,
		cleanLabel = '',
		cleanDot = false
	}: { counts: SeverityCounts; cleanLabel?: string; cleanDot?: boolean } = $props();

	const pills = $derived(sevPills(counts));
</script>

<div class="pills">
	{#each pills as p (p.key)}
		<span class="pill" style="--c:{p.color};--b:{p.bg}">{p.text}</span>
	{/each}
	{#if counts.total === 0 && cleanLabel}
		<span class="clean">
			{#if cleanDot}<span class="cdot"></span>{/if}{cleanLabel}
		</span>
	{/if}
</div>

<style>
	.pills {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
		align-items: center;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: 6px;
		font-family: 'IBM Plex Mono', monospace;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.02em;
		background: var(--b);
		color: var(--c);
		border: 1px solid var(--b);
		white-space: nowrap;
	}
	.clean {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: 'IBM Plex Mono', monospace;
		font-size: 12px;
		color: var(--accent);
	}
	.cdot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}
</style>
