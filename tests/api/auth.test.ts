import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkWriteAuth } from '$lib/server/auth';

describe('auth (checkWriteAuth)', () => {
	const originalToken = process.env.HERMES_API_TOKEN;

	beforeEach(() => {
		delete process.env.HERMES_API_TOKEN;
	});

	afterEach(() => {
		if (originalToken !== undefined) {
			process.env.HERMES_API_TOKEN = originalToken;
		} else {
			delete process.env.HERMES_API_TOKEN;
		}
	});

	it('allows all requests when HERMES_API_TOKEN is unset', () => {
		const req = new Request('http://localhost/api/repos', { method: 'POST' });
		const denied = checkWriteAuth(req);
		expect(denied).toBeNull();
	});

	it('returns 401 when token is set and Authorization header is missing', async () => {
		process.env.HERMES_API_TOKEN = 'secret-token-123';
		const req = new Request('http://localhost/api/repos', { method: 'POST' });
		const denied = checkWriteAuth(req);
		expect(denied).not.toBeNull();
		expect(denied?.status).toBe(401);
		const body = (await denied?.json()) as { error: string };
		expect(body.error).toBe('unauthorized');
	});

	it('returns 401 when token is set and Authorization header has wrong scheme or token', async () => {
		process.env.HERMES_API_TOKEN = 'secret-token-123';

		const reqBasic = new Request('http://localhost/api/repos', {
			method: 'POST',
			headers: { authorization: 'Basic dXNlcjpwYXNz' }
		});
		expect(checkWriteAuth(reqBasic)?.status).toBe(401);

		const reqWrong = new Request('http://localhost/api/repos', {
			method: 'POST',
			headers: { authorization: 'Bearer wrong-token' }
		});
		expect(checkWriteAuth(reqWrong)?.status).toBe(401);

		const reqSameLength = new Request('http://localhost/api/repos', {
			method: 'POST',
			headers: { authorization: 'Bearer secret-token-124' }
		});
		expect(checkWriteAuth(reqSameLength)?.status).toBe(401);
	});

	it('allows requests with the configured Bearer token', () => {
		process.env.HERMES_API_TOKEN = 'secret-token-123';
		const req = new Request('http://localhost/api/repos', {
			method: 'POST',
			headers: { authorization: 'Bearer secret-token-123' }
		});
		expect(checkWriteAuth(req)).toBeNull();
	});

	it('returns 401, not a throw, when the presented token differs in length (S1)', () => {
		process.env.HERMES_API_TOKEN = 'secret-token-123';
		for (const presented of ['secret', 'secret-token-1234', 'secret-token-12é']) {
			// 'secret-token-12é' has the token's character count but one more UTF-8 byte.
			const req = new Request('http://localhost/api/repos', {
				method: 'POST',
				headers: { authorization: `Bearer ${presented}` }
			});
			expect(checkWriteAuth(req)?.status).toBe(401);
		}
	});
});
