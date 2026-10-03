<script lang="ts">
	import { fmtInt } from '$lib/format';
	import type { TrendBucket } from '$lib/types';

	let { buckets }: { buckets: TrendBucket[] } = $props();
	const totals = $derived.by(() => {
		let introduced = 0;
		let fixed = 0;
		let peak = 1;
		for (const bucket of buckets) {
			introduced += bucket.newFindings;
			fixed += bucket.resolvedFindings;
			peak = Math.max(peak, bucket.newFindings, bucket.resolvedFindings);
		}
		return { introduced, fixed, backlog: introduced - fixed, peak };
	});
	const backlog = $derived(`${totals.backlog < 0 ? '−' : '+'}${fmtInt(Math.abs(totals.backlog))}`);
</script>

<figure class="trend-chart" aria-labelledby="trend-title trend-summary">
	<figcaption>
		<div class="chart-head">
			<h2 id="trend-title">Finding changes</h2>
			<div class="legend mono" aria-hidden="true"><span>↑ new</span><span class="fixed">↓ fixed</span></div>
		</div>
		<p id="trend-summary" class="summary mono">
			<span><strong class="new-total">+{fmtInt(totals.introduced)}</strong> new</span>
			<span>· <strong class="fixed-total">{fmtInt(totals.fixed)}</strong> fixed</span>
			<span>· backlog <strong class="backlog-total">{backlog}</strong> ({buckets.length}d)</span>
		</p>
	</figcaption>
	<svg class="plot" viewBox="0 0 {buckets.length * 24} 64" preserveAspectRatio="none" aria-hidden="true">
		<line x1="0" x2={buckets.length * 24} y1="32" y2="32" stroke="var(--border2)" />
		{#each buckets as bucket, i (bucket.date)}
			{@const newHeight = (bucket.newFindings / totals.peak) * 27}
			{@const fixedHeight = (bucket.resolvedFindings / totals.peak) * 27}
			<rect x={i * 24 + 3} y={32 - newHeight} width="8" height={newHeight} fill="var(--dim)">
				<title>{bucket.day} UTC: {bucket.newFindings} new findings</title>
			</rect>
			<rect x={i * 24 + 13} y="32" width="8" height={fixedHeight} fill="var(--accent)">
				<title>{bucket.day} UTC: {bucket.resolvedFindings} fixed findings</title>
			</rect>
		{/each}
	</svg>
	<div class="axis mono" aria-hidden="true">
		<span>{buckets[0]?.day ?? ''}</span><span>days in UTC</span><span>{buckets.at(-1)?.day ?? ''}</span>
	</div>
	<div class="visually-hidden">
		<table>
			<caption>Daily finding changes, days in UTC</caption>
			<thead><tr><th scope="col">UTC day</th><th scope="col">New findings</th><th scope="col">Fixed findings</th><th scope="col">Reviews</th></tr></thead>
			<tbody>
				{#each buckets as bucket (bucket.date)}
					<tr><th scope="row">{new Date(bucket.date).toISOString().slice(0, 10)}</th><td>{bucket.newFindings}</td><td>{bucket.resolvedFindings}</td><td>{bucket.reviews}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</figure>

<style>
	.trend-chart { min-width: 0; margin: 0; padding: 14px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
	.chart-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
	h2 { margin: 0; color: var(--dim); font-size: 13px; font-weight: 500; }
	.legend { display: flex; gap: 12px; color: var(--dim); font-size: 10px; }
	.fixed, .fixed-total { color: var(--accent); }
	.summary { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 8px; color: var(--dim); font-size: 11px; }
	.summary span { white-space: nowrap; }
	.new-total, .backlog-total { color: var(--text); }
	.plot { display: block; width: 100%; height: 58px; }
	.axis { display: flex; justify-content: space-between; margin-top: 3px; color: var(--faint); font-size: 10px; }
</style>
