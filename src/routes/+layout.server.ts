import { getMeta } from '$lib/server/meta';
import { getScan } from '$lib/server/scan';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	return {
		scan: getScan(),
		orgLabel: getMeta('org_label', 'Oasis Protocol')
	};
};
