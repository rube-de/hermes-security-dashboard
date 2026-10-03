import { browser } from '$app/environment';

/** How often relative times ("2h 14m ago", "in 3h") re-render. */
export const CLOCK_TICK_MS = 30_000;

/**
 * The one wall clock every rendered time reads. Server render and hydration run with
 * `live` false, so time components emit a zone-independent UTC form that is identical on
 * both sides (no hydration mismatch). `start()` runs once from the root layout's onMount,
 * i.e. after hydration: it flips `live`, switching every time to browser-local / relative
 * text, and ticks `now` so relative times stay current without a reload.
 */
class Clock {
	/** Epoch-ms; ticks every CLOCK_TICK_MS once `live`. */
	now = $state(Date.now());
	/** True in the browser after hydration: render local zone and relative times. */
	live = $state(false);

	private timer: NodeJS.Timeout | number | undefined;

	start() {
		if (!browser || this.timer !== undefined) return;
		this.now = Date.now();
		this.live = true;
		this.timer = setInterval(() => {
			this.now = Date.now();
		}, CLOCK_TICK_MS);
	}

	stop() {
		clearInterval(this.timer);
		this.timer = undefined;
	}
}

export const clock = new Clock();
