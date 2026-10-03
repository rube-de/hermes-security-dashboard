import { error } from '@sveltejs/kit';
import { getRepoRow } from '$lib/server/repos';
import { getReviewDetail } from '$lib/server/reviews';
import { langColor } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const review = getReviewDetail(params.rid);
	if (!review || review.repoId !== params.id) throw error(404, 'Review not found');
	const repo = getRepoRow(params.id);
	if (!repo) throw error(404, 'Repository not found');
	return {
		review,
		repo: { id: repo.id, path: repo.path, lang: repo.lang, langColor: langColor(repo.lang) }
	};
};
