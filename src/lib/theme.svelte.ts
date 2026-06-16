import { browser } from '$app/environment';

export type Theme = 'dark' | 'light';

/** Reactive theme controller. The actual <html data-theme> is the source of
 *  truth (set pre-paint in app.html); this mirrors it and persists changes. */
class ThemeState {
	current = $state<Theme>('dark');

	init() {
		if (!browser) return;
		const t = document.documentElement.dataset.theme;
		this.current = t === 'light' ? 'light' : 'dark';
	}

	set(t: Theme) {
		this.current = t;
		if (browser) {
			document.documentElement.dataset.theme = t;
			try {
				localStorage.setItem('hermes-theme', t);
			} catch {
				/* storage may be unavailable; theme still applies for the session */
			}
		}
	}

	toggle() {
		this.set(this.current === 'dark' ? 'light' : 'dark');
	}
}

export const theme = new ThemeState();
