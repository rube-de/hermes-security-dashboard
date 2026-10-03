import { browser } from '$app/environment';
import { base } from '$app/paths';
import { invalidateAll } from '$app/navigation';
import { fmtElapsed } from './format';
import type { ScanState } from './types';
const EMPTY: ScanState = {
	active: false,
	repoId: null,
	commit: null,
	currentFile: null,
	progress: 0,
	engine: null,
	startedAt: null,
	dataVersion: 1
};

/**
 * Live active-run controller. Polls /api/scan for agent-pushed updates and
 * ticks a local elapsed clock each second so the timer stays live between
 * polls. Source of truth is the server; nothing here fabricates progress.
 */
class ScanStore {
	state = $state<ScanState>(EMPTY);
	elapsed = $state(0); // seconds since started_at
	hydrated = $state(false);

	private pollTimer: NodeJS.Timeout | number | null = null;
	private tickTimer: NodeJS.Timeout | number | null = null;
	private abortController: AbortController | null = null;
	private lastDataVersion: number | null = null;
	private consecutiveErrors = 0;
	private isStopped = false;
	private visibilityListener: (() => void) | null = null;

	hydrate(initial: ScanState) {
		this.state = initial;
		if (this.lastDataVersion === null && typeof initial.dataVersion === 'number') {
			this.lastDataVersion = initial.dataVersion;
		}
		this.recompute();
	}

	start(initial: ScanState) {
		this.isStopped = false;
		this.hydrate(initial);
		if (!browser) return;
		this.hydrated = true;

		this.tickTimer = setInterval(() => this.recompute(), 1000);

		this.visibilityListener = () => {
			if (this.isStopped) return;
			if (document.hidden) {
				// Pause while tab is hidden
				clearTimeout(this.pollTimer as number);
				this.pollTimer = null;
				if (this.abortController) {
					this.abortController.abort();
					this.abortController = null;
				}
			} else {
				// Tab became visible: poll immediately
				clearTimeout(this.pollTimer as number);
				this.pollTimer = null;
				this.poll();
			}
		};
		document.addEventListener('visibilitychange', this.visibilityListener);

		// Schedule initial poll
		this.scheduleNext(3000);
	}

	stop() {
		this.isStopped = true;
		clearTimeout(this.pollTimer as number);
		this.pollTimer = null;
		clearInterval(this.tickTimer as number);
		this.tickTimer = null;
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		if (this.visibilityListener && typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.visibilityListener);
			this.visibilityListener = null;
		}
	}

	private scheduleNext(delayMs: number) {
		if (this.isStopped || (typeof document !== 'undefined' && document.hidden)) return;
		clearTimeout(this.pollTimer as number);
		this.pollTimer = setTimeout(() => {
			this.pollTimer = null;
			this.poll();
		}, delayMs);
	}

	private recompute() {
		const { startedAt, active } = this.state;
		this.elapsed = active && startedAt ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
	}

	private async poll() {
		if (this.isStopped || (typeof document !== 'undefined' && document.hidden)) return;

		// Guard against overlapping requests
		if (this.abortController) {
			this.abortController.abort();
		}
		const controller = new AbortController();
		this.abortController = controller;

		try {
			const res = await fetch(`${base}/api/scan`, {
				headers: { accept: 'application/json' },
				signal: controller.signal
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			const newState = (await res.json()) as ScanState;
			this.consecutiveErrors = 0;
			this.state = newState;
			this.recompute();

			if (typeof newState.dataVersion === 'number') {
				if (this.lastDataVersion !== null && newState.dataVersion !== this.lastDataVersion) {
					invalidateAll().catch((err) => {
						console.error('invalidateAll failed', err);
					});
				}
				this.lastDataVersion = newState.dataVersion;
			}

			if (!this.isStopped) {
				this.scheduleNext(3000);
			}
		} catch (err: unknown) {
			if ((err as Error)?.name === 'AbortError') {
				// Request was aborted (e.g. navigation or new poll scheduled), ignore
				return;
			}
			this.consecutiveErrors++;
			// Exponential backoff between 3s and 30s: 3000 * 2^(errors - 1) capped at 30000
			const backoffDelay = Math.min(30000, 3000 * Math.pow(2, this.consecutiveErrors - 1));
			if (!this.isStopped) {
				this.scheduleNext(backoffDelay);
			}
		} finally {
			if (this.abortController === controller) {
				this.abortController = null;
			}
		}
	}

	get elapsedLabel() {
		return fmtElapsed(this.elapsed);
	}
}

export const scan = new ScanStore();
