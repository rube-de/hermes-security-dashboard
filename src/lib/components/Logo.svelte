<script lang="ts">
	let { size = 30 }: { size?: number } = $props();
	const dot = $derived(Math.round(size * 0.37));
	const left = $derived(Math.round(size * 0.47));
	const top = $derived(Math.round(size * 0.1));
	const ring = $derived(Math.max(2, Math.round(size / 10)));
</script>

<div class="logo" style="width:{size}px;height:{size}px">
	<div class="ring" style="border-width:{ring}px"></div>
	<div class="dot" style="width:{dot}px;height:{dot}px;left:{left}px;top:{top}px"></div>
</div>

<style>
	.logo {
		position: relative;
		flex: none;
	}
	.ring {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border-style: solid;
		border-color: var(--accent);
	}
	.dot {
		position: absolute;
		border-radius: 50%;
		background: var(--accent);
	}
</style>
