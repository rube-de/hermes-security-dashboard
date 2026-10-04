<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';

	let container: HTMLDivElement;
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	onMount(() => {
		let destroyed = false;
		let destroyFn: (() => void) | undefined;

		(async () => {
			try {
				const [{ createApiReference }] = await Promise.all([
					import('@scalar/api-reference'),
					import('@scalar/api-reference/style.css')
				]);

				if (destroyed) return;
				loading = false;
				const ref = createApiReference(container, { url: `${base}/openapi.yaml` });
				destroyFn = () => ref.destroy();
			} catch (err) {
				if (destroyed) return;
				loading = false;
				loadError = (err as Error).message || 'Failed to load API reference';
			}
		})();

		return () => {
			destroyed = true;
			destroyFn?.();
		};
	});
</script>

<svelte:head>
	<title>API reference · Hermes Security Dashboard</title>
</svelte:head>

<main class="docs-main">
	{#if loading}
		<div class="docs-loading mono">
			<span class="spinner" aria-hidden="true">↻</span> Loading API reference…
		</div>
	{:else if loadError}
		<div class="docs-error mono" role="alert">
			Failed to load API reference: {loadError}
		</div>
	{/if}
	<div bind:this={container} class:hidden={loading || !!loadError}></div>
</main>

<style>
	.docs-main {
		padding-top: 20px;
		padding-bottom: 20px;
	}
	.docs-loading,
	.docs-error {
		padding: 40px 20px;
		text-align: center;
		color: var(--text-muted, #7e8b9b);
		font-size: 14px;
	}
	.docs-error {
		color: var(--crit, #c0223f);
	}
	.spinner {
		display: inline-block;
		animation: spin 1.2s linear infinite;
		margin-right: 6px;
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.hidden {
		display: none;
	}
</style>
