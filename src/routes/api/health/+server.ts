import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	try {
		db.prepare('SELECT 1').get();
		return json({ ok: true, service: 'hermes-security-dashboard' });
	} catch (err) {
		return json(
			{
				ok: false,
				service: 'hermes-security-dashboard',
				error: (err instanceof Error && err.message) || 'database unavailable'
			},
			{ status: 503 }
		);
	}
};
