import { browser } from '$app/environment';
import { fmtElapsed } from './format';
import type { ScanState } from './types';

const EMPTY: ScanState = {
	active: false,
	repoId: null,
	commit: null,
	currentFile: null,
	progress: 0,
	engine: null,
	startedAt: null
};

/**
 * Live active-run controller. Polls /api/scan for agent-pushed updates and
 * ticks a local elapsed clock each second so the timer stays live between
 * polls. Source of truth is the server; nothing here fabricates progress.
 */
class ScanStore {
	state = $state<ScanState>(EMPTY);
	elapsed = $state(0); // seconds since started_at
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private tickTimer: ReturnType<typeof setInterval> | null = null;

	hydrate(initial: ScanState) {
		this.state = initial;
		this.recompute();
	}

	start(initial: ScanState) {
		this.hydrate(initial);
		if (!browser) return;
		this.tickTimer = setInterval(() => this.recompute(), 1000);
		this.pollTimer = setInterval(() => this.poll(), 3000);
	}

	stop() {
		if (this.pollTimer) clearInterval(this.pollTimer);
		if (this.tickTimer) clearInterval(this.tickTimer);
		this.pollTimer = this.tickTimer = null;
	}

	private recompute() {
		const { startedAt, active } = this.state;
		this.elapsed = active && startedAt ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
	}

	private async poll() {
		try {
			const res = await fetch('/api/scan', { headers: { accept: 'application/json' } });
			if (!res.ok) return;
			this.state = (await res.json()) as ScanState;
			this.recompute();
		} catch (err) {
			// Transient network/poll failure — keep the last known state, try again next tick.
			console.error('scan poll failed', err);
		}
	}

	get elapsedLabel() {
		return fmtElapsed(this.elapsed);
	}
}

export const scan = new ScanStore();
