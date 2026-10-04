<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { theme } from '$lib/theme.svelte';
	import { scan } from '$lib/scan.svelte';
	import { clock } from '$lib/clock.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// Runs after hydration, so the clock going live (local zone, relative times) never
	// races the server-rendered markup.
	onMount(() => {
		theme.init();
		clock.start();
		scan.start(data.scan);
		return () => {
			scan.stop();
			clock.stop();
		};
	});
</script>

<div class="app-shell">
	<Header />
	<div class="content">
		{@render children()}
	</div>
	<Footer />
</div>

<style>
	.app-shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}
	.content {
		flex: 1;
	}
</style>
