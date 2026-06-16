import { json } from '@sveltejs/kit';

/**
 * Guards write endpoints. Auth is OFF by default (no token configured), so the
 * Hermes agent can post freely on a private server. Setting HERMES_API_TOKEN in
 * the environment turns on Bearer-token enforcement for all writes — no code
 * change required.
 */
export function checkWriteAuth(request: Request): Response | null {
	const token = process.env.HERMES_API_TOKEN;
	if (!token) return null; // auth disabled

	const header = request.headers.get('authorization') ?? '';
	const match = header.match(/^Bearer\s+(.+)$/i);
	if (!match || match[1] !== token) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}
	return null;
}
