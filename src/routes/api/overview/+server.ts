import { json } from '@sveltejs/kit';
import { getOverview } from '$lib/server/store';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(getOverview());
