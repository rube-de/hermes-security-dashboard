<script lang="ts">
	import { fmtInt, SEVERITIES, SEV_LABEL, SEV_VAR } from '$lib/format';
	import type { SeverityCounts } from '$lib/types';

	let { counts, quietedCount = 0 }: { counts: SeverityCounts; quietedCount?: number } = $props();
</script>

<section class="severity-strip" aria-label="Open findings by severity">
	<div class="strip-head">
		<div class="headline">
			<strong class="display">{fmtInt(counts.total)}</strong>
			<span>Open findings</span>
		</div>
		{#if quietedCount}<span class="triaged mono">{fmtInt(quietedCount)} triaged</span>{/if}
	</div>
	<div class="severity-bar" aria-hidden="true">
		{#each SEVERITIES as severity (severity)}
			<div style="width:{counts.total ? (counts[severity] / counts.total) * 100 : 0}%;background:{SEV_VAR[severity]}"></div>
		{/each}
	</div>
	<ul class="legend mono">
		{#each SEVERITIES as severity (severity)}
			<li style="color:{SEV_VAR[severity]}">{SEV_LABEL[severity]} <strong>{fmtInt(counts[severity])}</strong></li>
		{/each}
	</ul>
</section>

<style>
	.severity-strip { padding: 16px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
	.strip-head, .headline { display: flex; align-items: center; gap: 10px; }
	.strip-head { justify-content: space-between; }
	.headline strong { font-size: 30px; line-height: 1; }
	.headline span { color: var(--dim); font-size: 13px; }
	.triaged { color: var(--faint); font-size: 11px; }
	.severity-bar { display: flex; height: 7px; margin-top: 13px; border-radius: 4px; overflow: hidden; background: var(--surface2); }
	.legend { display: flex; flex-wrap: wrap; gap: 8px 18px; list-style: none; margin: 10px 0 0; padding: 0; font-size: 11px; }
	@media (max-width: 480px) { .legend { display: grid; grid-template-columns: 1fr 1fr; } }
</style>
