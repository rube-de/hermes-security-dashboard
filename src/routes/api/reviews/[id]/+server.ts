import { json } from '@sveltejs/kit';
import { getReviewDetail } from '$lib/server/store';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const review = getReviewDetail(params.id);
	if (!review) return json({ error: 'review not found' }, { status: 404 });
	return json(review);
};
