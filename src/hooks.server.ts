import { building, dev } from '$app/environment';
import { seedIfEmpty } from '$lib/server/seed';
import { startDurability } from '$lib/server/durability';

/** Runs once when the server starts (not during build). Seeds demo data on an
 *  empty database; a no-op once the Hermes agent has posted real data. In
 *  production it also warns about open writes and starts the snapshot loop. */
export function init() {
	if (building) return;
	seedIfEmpty();

	// dev is intentionally open and ephemeral — keep its startup quiet and don't
	// install snapshot/shutdown machinery there.
	if (dev) return;

	if (!process.env.HERMES_API_TOKEN) {
		console.warn(
			'[hermes] WARNING: HERMES_API_TOKEN is not set — write endpoints ' +
				'(POST /api/repos, POST /api/repos/:id/reviews, PUT /api/scan) are UNAUTHENTICATED.'
		);
	}

	startDurability();
}
