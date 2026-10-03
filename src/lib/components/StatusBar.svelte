<script lang="ts">
	import { fmtDur } from '$lib/format';
	import type { ScanState } from '$lib/types';
	import ActiveRunCard from './ActiveRunCard.svelte';
	import Time from './Time.svelte';

	let {
		lastRunAt, nextRunAt, avgScanSecs, scanState, elapsedLabel
	}: {
		lastRunAt: number | null;
		nextRunAt: number | null;
		avgScanSecs: number | null;
		scanState: ScanState;
		elapsedLabel: string;
	} = $props();
</script>

<section class="status-bar" aria-label="Scan schedule and activity">
	<dl>
		<div><dt>Last run</dt><dd>{#if lastRunAt !== null}<Time ts={lastRunAt} mode="ago" />{:else}never{/if}</dd></div>
		<div><dt>Next run</dt><dd>{#if nextRunAt !== null}<Time ts={nextRunAt} mode="until" />{:else}unscheduled{/if}</dd></div>
		{#if avgScanSecs !== null}<div><dt>Avg</dt><dd>{fmtDur(avgScanSecs)}</dd></div>{/if}
	</dl>
	<ActiveRunCard state={scanState} {elapsedLabel} />
</section>

<style>
	.status-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px 18px; margin: 16px 0 20px; padding: 11px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
	dl { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; margin: 0; font-size: 12px; }
	dl div { display: flex; gap: 6px; }
	dt { color: var(--faint); }
	dd { margin: 0; color: var(--dim); }
	@media (max-width: 600px) { dl { gap: 8px 12px; } }
</style>
