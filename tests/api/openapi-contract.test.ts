import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from 'yaml';
import specYaml from '$lib/server/openapi.yaml?raw';
import { GET as getOverview } from '../../src/routes/api/overview/+server';
import { GET as getRepos } from '../../src/routes/api/repos/+server';
import { GET as getRepo } from '../../src/routes/api/repos/[id]/+server';
import { GET as getRepoReviews } from '../../src/routes/api/repos/[id]/reviews/+server';
import { GET as getReviews } from '../../src/routes/api/reviews/+server';
import { GET as getReview } from '../../src/routes/api/reviews/[id]/+server';
import { GET as getScan } from '../../src/routes/api/scan/+server';
import { GET as getTrends } from '../../src/routes/api/trends/+server';
import { addRepo } from '$lib/server/repos';
import { insertReview } from '$lib/server/ingest';
import { setNextRun } from '$lib/server/meta';
import { setScan } from '$lib/server/scan';
import { setTriage } from '$lib/server/triage';
import { resetDb, callApi } from '../test-utils';
import type { ReviewDetail } from '$lib/types';

/** The subset of OpenAPI 3.1 / JSON Schema that openapi.yaml uses. */
interface Schema {
	$ref?: string;
	type?: string | string[];
	properties?: Record<string, Schema>;
	required?: string[];
	items?: Schema;
	allOf?: Schema[];
	oneOf?: Schema[];
	anyOf?: Schema[];
	enum?: unknown[];
	const?: unknown;
}

interface Operation {
	responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}

interface Spec {
	paths: Record<string, Record<string, Operation>>;
	components: { schemas: Record<string, Schema> };
}

const spec = parse(specYaml) as Spec;

/** The documented 200 JSON body of `GET path`. */
function responseSchema(path: string): Schema {
	const schema = spec.paths[path]?.get?.responses['200']?.content?.['application/json']?.schema;
	if (!schema) throw new Error(`spec documents no 200 JSON response for GET ${path}`);
	return schema;
}

/** Follow `$ref`s and flatten `allOf` into a single schema. */
function resolve(schema: Schema): Schema {
	if (schema.$ref) {
		const target = spec.components.schemas[schema.$ref.replace('#/components/schemas/', '')];
		if (!target) throw new Error(`dangling ${schema.$ref}`);
		return resolve(target);
	}
	if (!schema.allOf) return schema;
	const parts = schema.allOf.map(resolve);
	return {
		type: parts.find((p) => p.type !== undefined)?.type,
		properties: Object.assign({}, ...parts.map((p) => p.properties)),
		required: parts.flatMap((p) => p.required ?? [])
	};
}

function jsonType(v: unknown): string {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'array';
	return Number.isInteger(v) ? 'integer' : typeof v;
}

/**
 * Every way `value` disagrees with `schema`, recursively: an object must carry exactly
 * the documented properties (nothing undocumented, nothing documented but missing), and
 * every value must have a documented type. Empty means the response matches the spec.
 */
function violations(value: unknown, schema: Schema, at = '$'): string[] {
	const s = resolve(schema);
	const branches = s.oneOf ?? s.anyOf;
	if (branches) {
		const results = branches.map((b) => violations(value, b, at));
		if (results.some((r) => r.length === 0)) return [];
		return [`${at}: matches no oneOf/anyOf branch (${results.map((r) => r[0]).join('; ')})`];
	}

	const actual = jsonType(value);
	const allowed = s.type === undefined ? null : [s.type].flat();
	if (allowed && !allowed.includes(actual) && !(actual === 'integer' && allowed.includes('number'))) {
		return [`${at}: ${actual} ${JSON.stringify(value)}, spec says ${allowed.join(' | ')}`];
	}
	if (s.const !== undefined && value !== s.const) return [`${at}: ${JSON.stringify(value)} is not the const`];
	if (s.enum && !s.enum.includes(value)) return [`${at}: ${JSON.stringify(value)} is not in the enum`];

	if (Array.isArray(value)) {
		const items = s.items;
		return items ? value.flatMap((v, i) => violations(v, items, `${at}[${i}]`)) : [];
	}
	if (actual !== 'object') return [];

	const obj = value as Record<string, unknown>;
	const props = s.properties ?? {};
	const out: string[] = [];
	for (const k of Object.keys(obj)) if (!(k in props)) out.push(`${at}.${k}: returned but not in the spec`);
	for (const k of Object.keys(props)) if (!(k in obj)) out.push(`${at}.${k}: in the spec but not returned`);
	for (const k of s.required ?? []) if (!(k in props)) out.push(`${at}.${k}: required but not declared`);
	for (const [k, v] of Object.entries(obj)) if (k in props) out.push(...violations(v, props[k], `${at}.${k}`));
	return out;
}

describe('OpenAPI spec matches read responses', () => {
	const T0 = Date.UTC(2026, 5, 16, 9, 46, 12);
	const HOUR = 3_600_000;
	const repoId = 'oasis-core';
	let headReviewId = '';

	// Exercise nullable and nested fields both ways: a never-scanned repo (null run
	// fields), a second commit (prevCommit + a resolved finding), an HTML body, a
	// scheduled next run.
	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'Rust', description: 'Core consensus' });
		addRepo({ id: 'never-scanned', lang: 'Go' });
		insertReview(repoId, {
			commit: 'c001',
			createdAt: T0,
			durationSecs: 231,
			findings: [
				{ severity: 'high', file: 'src/main.rs', title: 'Buffer overflow' },
				{ severity: 'low', file: 'src/lib.rs', title: 'Unused import' }
			]
		});
		headReviewId = insertReview(repoId, {
			commit: 'c002',
			createdAt: T0 + HOUR,
			durationSecs: 200,
			html: '<p>Notes</p>',
			findings: [{ severity: 'high', file: 'src/main.rs', title: 'Buffer overflow' }]
		}).id;
		setNextRun(T0 + 6 * HOUR);
	});

	it('GET /api/overview', async () => {
		const res = await callApi(getOverview);
		expect(res.status).toBe(200);
		expect(violations(res.body, responseSchema('/api/overview'))).toEqual([]);
	});

	it('GET /api/repos', async () => {
		const res = await callApi(getRepos);
		expect(res.status).toBe(200);
		expect(violations(res.body, responseSchema('/api/repos'))).toEqual([]);
	});

	it('GET /api/repos/{id}, scanned and never scanned', async () => {
		for (const id of [repoId, 'never-scanned']) {
			const res = await callApi(getRepo, { params: { id } });
			expect(res.status).toBe(200);
			expect(violations(res.body, responseSchema('/api/repos/{id}'))).toEqual([]);
		}
	});

	it('GET /api/repos/{id}/reviews', async () => {
		const res = await callApi(getRepoReviews, { params: { id: repoId } });
		expect(res.status).toBe(200);
		expect(violations(res.body, responseSchema('/api/repos/{id}/reviews'))).toEqual([]);
	});

	it('GET /api/reviews', async () => {
		const res = await callApi(getReviews);
		expect(res.status).toBe(200);
		expect(violations(res.body, responseSchema('/api/reviews'))).toEqual([]);
	});

	it('GET /api/reviews/{id}, with a triaged finding and a resolved one', async () => {
		const before = await callApi<ReviewDetail>(getReview, { params: { id: headReviewId } });
		setTriage(repoId, before.body.findings[0].fingerprint, 'acknowledged', 'Tracked upstream', 'alice');

		const res = await callApi<ReviewDetail>(getReview, { params: { id: headReviewId } });
		expect(res.status).toBe(200);
		expect(res.body.findings[0].triage).not.toBeNull();
		expect(res.body.resolved).toHaveLength(1);
		expect(violations(res.body, responseSchema('/api/reviews/{id}'))).toEqual([]);
	});

	it('GET /api/scan, idle and active', async () => {
		const idle = await callApi(getScan);
		expect(violations(idle.body, responseSchema('/api/scan'))).toEqual([]);

		setScan({ active: true, repoId, commit: 'c003', currentFile: 'src/main.rs', progress: 40, startedAt: T0 });
		const active = await callApi(getScan);
		expect(violations(active.body, responseSchema('/api/scan'))).toEqual([]);
	});

	it('GET /api/trends', async () => {
		const res = await callApi(getTrends, { url: 'http://localhost/api/trends?days=7' });
		expect(res.status).toBe(200);
		expect(violations(res.body, responseSchema('/api/trends'))).toEqual([]);
	});

	it('reports drift in either direction, at any depth', async () => {
		const { body } = await callApi<Record<string, unknown>>(getOverview);
		const schema = responseSchema('/api/overview');
		expect(violations({ ...body, lastRunLabel: '2h ago' }, schema)).toEqual([
			'$.lastRunLabel: returned but not in the spec'
		]);
		const { lastRunAt: _dropped, ...missing } = body;
		expect(violations(missing, schema)).toEqual(['$.lastRunAt: in the spec but not returned']);
		expect(violations({ ...body, avgScanSecs: 100.5 }, schema)).toEqual([
			'$.avgScanSecs: number 100.5, spec says integer | null'
		]);
		const [repo] = body.repos as Record<string, unknown>[];
		expect(violations({ ...body, repos: [{ ...repo, glyph: '[!!]' }] }, schema)).toEqual([
			'$.repos[0].glyph: returned but not in the spec'
		]);
	});
});
