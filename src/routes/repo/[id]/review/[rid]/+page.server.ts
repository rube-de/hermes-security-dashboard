import { error } from '@sveltejs/kit';
import { getRepoDetail, getReviewDetail } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const review = getReviewDetail(params.rid);
	if (!review || review.repoId !== params.id) throw error(404, 'Review not found');
	const repo = getRepoDetail(params.id);
	if (!repo) throw error(404, 'Repository not found');
	return {
		review,
		repo: { id: repo.id, path: repo.path, lang: repo.lang, langColor: repo.langColor }
	};
};
