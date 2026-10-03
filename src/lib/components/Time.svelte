<script lang="ts">
	import { clock } from '$lib/clock.svelte';
	import { fmtAgo, fmtDate, fmtDateFull, fmtUntil } from '$lib/format';

	let {
		ts,
		mode = 'date'
	}: {
		/** Epoch-ms. */
		ts: number;
		/** `date`: "Jun 16 · 09:46" · `ago`: "2h 14m ago" · `until`: "in 3h 46m" / "due now". */
		mode?: 'date' | 'ago' | 'until';
	} = $props();

	// Until the clock is live (server render and hydration) show the UTC date, which is
	// identical on both sides; then browser-local or relative text, re-rendered each tick.
	const text = $derived.by(() => {
		if (!clock.live) return `${fmtDate(ts, 'UTC')} UTC`;
		if (mode === 'ago') return fmtAgo(ts, clock.now);
		if (mode === 'until') return fmtUntil(ts, clock.now);
		return fmtDate(ts);
	});
	const title = $derived(fmtDateFull(ts, clock.live ? undefined : 'UTC'));
</script>

<time datetime={new Date(ts).toISOString()} {title}>{text}</time>
