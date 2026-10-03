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
	});

	// KNOWN-WRONG (S1, fixed by T06): checkWriteAuth uses loose !== comparison instead of timingSafeEqual
	it('allows requests with valid Bearer token (KNOWN-WRONG: S1 non-constant-time comparison)', () => {
		process.env.HERMES_API_TOKEN = 'secret-token-123';
		const req = new Request('http://localhost/api/repos', {
			method: 'POST',
			headers: { authorization: 'Bearer secret-token-123' }
		});
		const denied = checkWriteAuth(req);
		expect(denied).toBeNull();
	});
});
