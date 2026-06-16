import { building } from '$app/environment';
import { seedIfEmpty } from '$lib/server/seed';

/** Runs once when the server starts (not during build). Seeds demo data on an
 *  empty database; a no-op once the Hermes agent has posted real data. */
export function init() {
	if (building) return;
	seedIfEmpty();
}
