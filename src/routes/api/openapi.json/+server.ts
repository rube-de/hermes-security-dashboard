import { json } from '@sveltejs/kit';
import { parse } from 'yaml';
import type { RequestHandler } from './$types';
import specYaml from '$lib/server/openapi.yaml?raw';

// Parsed once at module load from the single YAML source so JSON consumers
// (codegen, tooling) and /openapi.yaml stay in lockstep.
const spec = parse(specYaml);

export const GET: RequestHandler = () => json(spec);
