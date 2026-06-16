import { getMeta, getScan } from '$lib/server/store';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	return {
		scan: getScan(),
		orgLabel: getMeta('org_label', 'Oasis Protocol')
	};
};
