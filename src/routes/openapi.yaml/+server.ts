import type { RequestHandler } from './$types';
import spec from '$lib/server/openapi.yaml?raw';

// /openapi.yaml and /api/openapi.json both derive from the single source at
// src/lib/server/openapi.yaml, so the two representations can never drift.
export const GET: RequestHandler = () =>
	new Response(spec, {
		headers: {
			'content-type': 'text/yaml; charset=utf-8',
			'cache-control': 'public, max-age=300'
		}
	});
