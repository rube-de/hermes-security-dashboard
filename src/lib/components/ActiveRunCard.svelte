<script lang="ts">
	import { base } from '$app/paths';
	import type { ScanState } from '$lib/types';

	let { state, elapsedLabel }: { state: ScanState; elapsedLabel: string } = $props();
</script>

<div class="active-run" role="status">
	{#if state.active}
		<span class="scan-dot" aria-hidden="true"></span>
		<span class="label">Scanning</span>
		{#if state.repoId}
			<a class="mono repo-id" href="{base}/repo/{state.repoId}" title={state.currentFile ?? undefined}>{state.repoId}</a>
		{/if}
		<span class="mono elapsed">{elapsedLabel}</span>
		<progress value={state.progress} max="100" aria-label="Active scan progress">{state.progress}%</progress>
	{:else}
		<span class="label idle">No active scan</span>
	{/if}
</div>

<style>
	.active-run { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; min-width: 0; font-size: 12px; }
	.scan-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--accent); animation: hpulse 1.6s infinite; }
	.label { color: var(--accent); }
	.idle { color: var(--faint); }
	.repo-id { font-size: 11px; overflow-wrap: anywhere; }
	.repo-id:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
	.elapsed { color: var(--dim); font-size: 11px; }
	progress { width: 64px; height: 4px; appearance: none; border: 0; border-radius: 2px; overflow: hidden; background: var(--surface2); }
	progress::-webkit-progress-bar { background: var(--surface2); }
	progress::-webkit-progress-value { background: var(--accent); }
	progress::-moz-progress-bar { background: var(--accent); }
</style>
