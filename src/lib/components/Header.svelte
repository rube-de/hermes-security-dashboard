<script lang="ts">
	import { page } from '$app/state';
	import { theme } from '$lib/theme.svelte';
	import { scan } from '$lib/scan.svelte';
	import Logo from './Logo.svelte';

	const path = $derived(page.url.pathname);
	const repoId = $derived(page.params.id ?? null);
	const isReview = $derived(/^\/repo\/[^/]+\/review\//.test(path));
	const isRepo = $derived(/^\/repo\/[^/]+\/?$/.test(path));
	const commit = $derived((page.data as { review?: { commit?: string } })?.review?.commit ?? null);
</script>

<header>
	<a class="brand" href="/">
		<Logo size={30} />
		<div class="brand-text">
			<div class="brand-name display">HERMES</div>
			<div class="brand-sub mono">Oasis Security Agent</div>
		</div>
	</a>

	<nav class="crumbs mono">
		<span class="sep">/</span>
		<a href="/" class="crumb-link">overview</a>
		{#if isRepo && repoId}
			<span class="sep">/</span>
			<span class="crumb-cur">{repoId}</span>
		{/if}
		{#if isReview && repoId}
			<span class="sep">/</span>
			<a href="/repo/{repoId}" class="crumb-link">{repoId}</a>
			<span class="sep">/</span>
			<span class="crumb-cur">{commit ?? 'report'}</span>
		{/if}
	</nav>

	<div class="spacer"></div>

	{#if scan.state.active}
		<a class="scan-pill mono" href={scan.state.repoId ? `/repo/${scan.state.repoId}` : '/'}>
			<span class="scan-dot"></span>
			<span>SCAN ACTIVE · {scan.elapsedLabel}</span>
		</a>
	{/if}

	<div class="theme-toggle">
		<button
			class="tbtn"
			class:on={theme.current === 'dark'}
			aria-label="Dark theme"
			onclick={() => theme.set('dark')}>☾</button
		>
		<button
			class="tbtn"
			class:on={theme.current === 'light'}
			aria-label="Light theme"
			onclick={() => theme.set('light')}>☀</button
		>
	</div>
</header>

<style>
	header {
		position: sticky;
		top: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 13px 26px;
		background: color-mix(in srgb, var(--bg2) 88%, transparent);
		border-bottom: 1px solid var(--border);
		backdrop-filter: blur(10px);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 11px;
	}
	.brand-text {
		line-height: 1.15;
	}
	.brand-name {
		font-weight: 700;
		font-size: 16px;
		letter-spacing: 0.06em;
		color: var(--text);
	}
	.brand-sub {
		font-size: 9.5px;
		letter-spacing: 0.22em;
		color: var(--faint);
		text-transform: uppercase;
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--faint);
	}
	.sep {
		color: var(--border2);
	}
	.crumb-link {
		color: var(--dim);
		transition: color 0.15s;
	}
	.crumb-link:hover {
		color: var(--accent);
	}
	.crumb-cur {
		color: var(--text);
	}
	.spacer {
		flex: 1;
	}
	.scan-pill {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 11px;
		border-radius: 99px;
		background: var(--accentB);
		border: 1px solid var(--accent);
		color: var(--accent);
		font-size: 11px;
		font-weight: 600;
	}
	.scan-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		animation: hpulse 1.6s infinite;
	}
	.theme-toggle {
		display: flex;
		gap: 3px;
		padding: 3px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 9px;
	}
	.tbtn {
		width: 30px;
		height: 26px;
		display: grid;
		place-items: center;
		border: none;
		cursor: pointer;
		border-radius: 6px;
		background: transparent;
		color: var(--faint);
		font-size: 13px;
		transition: all 0.15s;
	}
	.tbtn.on {
		background: var(--surface);
		color: var(--accent);
		box-shadow: 0 1px 2px var(--shadow);
	}

	@media (max-width: 640px) {
		.brand-sub,
		.crumbs {
			display: none;
		}
		header {
			gap: 12px;
			padding: 12px 16px;
		}
	}
</style>
