<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { createApiReference } from '@scalar/api-reference';
	import '@scalar/api-reference/style.css';

	let container: HTMLDivElement;

	onMount(() => {
		// Point Scalar at the served spec (base-path aware so it works under /security too).
		const ref = createApiReference(container, { url: `${base}/openapi.yaml` });
		return () => ref.destroy();
	});
</script>

<svelte:head>
	<title>API reference · Hermes Security Dashboard</title>
</svelte:head>

<div bind:this={container}></div>
