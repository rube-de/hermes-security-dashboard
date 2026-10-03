import { db } from '$lib/server/db';
import { isHttpError } from '@sveltejs/kit';

/**
 * Resets the in-memory database to a clean, empty state with default singleton rows.
 * Call this in `beforeEach()` when tests within the same file need an isolated database.
 */
export function resetDb(): void {
	db.exec('PRAGMA foreign_keys = OFF;');
	db.exec('DELETE FROM finding_triage;');
	db.exec('DELETE FROM findings;');
	db.exec('DELETE FROM reviews;');
	db.exec('DELETE FROM repos;');
	db.exec('DELETE FROM meta;');
	db.exec('DELETE FROM scan;');
	db.exec('INSERT INTO scan (id, active) VALUES (1, 0);');
	db.exec('PRAGMA foreign_keys = ON;');
}

export interface ApiCallOptions {
	method?: string;
	url?: string | URL;
	body?: unknown;
	headers?: Record<string, string>;
	params?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
	status: number;
	body: T;
	headers: Headers;
	response: Response | null;
}

/**
 * Invokes a SvelteKit API route handler with a minimal RequestEvent.
 * The `never` parameter type leverages contravariance so any route-specific RequestEvent
 * handler is assignable here without disabling type checking.
 * Automatically parses JSON responses and catches thrown HttpErrors (from @sveltejs/kit `error()`).
 */
export async function callApi<T = unknown>(
	handler: (event: never) => Promise<Response> | Response,
	options: ApiCallOptions = {}
): Promise<ApiResponse<T>> {
	const urlObj =
		typeof options.url === 'string'
			? new URL(options.url, 'http://localhost')
			: options.url ?? new URL('http://localhost');
	const headers = new Headers(options.headers);
	let reqBody: string | undefined = undefined;

	if (options.body !== undefined) {
		if (typeof options.body === 'string') {
			reqBody = options.body;
		} else {
			reqBody = JSON.stringify(options.body);
			if (!headers.has('content-type')) {
				headers.set('content-type', 'application/json');
			}
		}
	}

	const request = new Request(urlObj.toString(), {
		method: options.method ?? 'GET',
		headers,
		body: reqBody
	});

	const event = {
		request,
		url: urlObj,
		params: options.params ?? {}
	};

	try {
		// Route handlers only access request, url, and params.
		const res = await handler(event as never);
		const text = await res.text();
		let jsonBody: unknown = null;
		try {
			jsonBody = text ? JSON.parse(text) : null;
		} catch {
			jsonBody = text;
		}
		return {
			status: res.status,
			body: jsonBody as T,
			headers: res.headers,
			response: res
		};
	} catch (err) {
		if (isHttpError(err)) {
			return {
				status: err.status,
				body: err.body as T,
				headers: new Headers(),
				response: null
			};
		}
		throw err;
	}
}
