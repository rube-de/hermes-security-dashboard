<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { theme } from '$lib/theme.svelte';
	import { scan } from '$lib/scan.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	onMount(() => {
		theme.init();
		scan.start(data.scan);
		return () => scan.stop();
	});
</script>

<Header />
{@render children()}
