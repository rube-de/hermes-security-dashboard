import { error } from '@sveltejs/kit';
import { getRepoDetail } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const repo = getRepoDetail(params.id);
	if (!repo) throw error(404, `Repository "${params.id}" not found`);
	return { repo };
};
