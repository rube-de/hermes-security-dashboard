<script lang="ts">
	import { base } from '$app/paths';
</script>

<footer class="footer">
	<div class="footer-inner mono">
		<div class="footer-brand">
			<span>Hermes Security Dashboard</span>
		</div>
		<nav class="footer-links">
			<a href="{base}/docs" class="footer-link">API reference</a>
			<span class="sep" aria-hidden="true">·</span>
			<a href="{base}/openapi.yaml" class="footer-link">OpenAPI spec</a>
		</nav>
	</div>
</footer>

<style>
	.footer {
		border-top: 1px solid var(--border);
		background: var(--bg2);
		margin-top: auto;
	}
	.footer-inner {
		max-width: 1280px;
		margin: 0 auto;
		padding: 18px 26px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
		color: var(--faint);
		gap: 16px;
		flex-wrap: wrap;
	}
	.footer-links {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.footer-link {
		color: var(--dim);
		text-decoration: none;
		transition: color 0.15s;
	}
	.footer-link:hover {
		color: var(--accent);
	}
	.sep {
		color: var(--faint);
	}
</style>
