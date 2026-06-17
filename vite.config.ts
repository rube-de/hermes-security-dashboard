import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Build-time base path. Empty by default → app serves at root (unchanged for
// `bun run dev` and root deploys). Set BASE_PATH=/security to serve the whole
// app (UI + /api/*) under that prefix behind a path-routing reverse proxy.
const rawBase = process.env.BASE_PATH ?? '';
if (rawBase && (!rawBase.startsWith('/') || rawBase.endsWith('/'))) {
	throw new Error(`BASE_PATH must start with "/" and not end with "/" (got "${rawBase}")`);
}
const base = rawBase as '' | `/${string}`;

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			paths: { base }
		})
	]
});
