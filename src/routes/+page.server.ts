import { getOverview } from '$lib/server/overview';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return { overview: getOverview() };
};
