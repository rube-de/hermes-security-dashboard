import { getOverview } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return { overview: getOverview() };
};
