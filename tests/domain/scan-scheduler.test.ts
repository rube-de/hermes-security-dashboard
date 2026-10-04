import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

export interface ScanPollSchedulerOptions {
	pollFn: () => Promise<number | undefined>; // returns dataVersion
	onVersionChange: (newVersion: number) => void;
	baseIntervalMs?: number;
	maxBackoffMs?: number;
}

export class ScanPollScheduler {
	private pollFn: () => Promise<number | undefined>;
	private onVersionChange: (newVersion: number) => void;
	private baseIntervalMs: number;
	private maxBackoffMs: number;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private lastVersion: number | null = null;
	private consecutiveErrors = 0;
	private isStopped = false;
	private isHidden = false;

	constructor(options: ScanPollSchedulerOptions) {
		this.pollFn = options.pollFn;
		this.onVersionChange = options.onVersionChange;
		this.baseIntervalMs = options.baseIntervalMs ?? 3000;
		this.maxBackoffMs = options.maxBackoffMs ?? 30000;
	}

	initVersion(version: number) {
		if (this.lastVersion === null) {
			this.lastVersion = version;
		}
	}

	start() {
		this.isStopped = false;
		this.scheduleNext(this.baseIntervalMs);
	}

	stop() {
		this.isStopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	setVisibility(hidden: boolean) {
		this.isHidden = hidden;
		if (hidden) {
			if (this.timer) {
				clearTimeout(this.timer);
				this.timer = null;
			}
		} else {
			if (this.timer) {
				clearTimeout(this.timer);
				this.timer = null;
			}
			this.tick();
		}
	}

	private scheduleNext(delayMs: number) {
		if (this.isStopped || this.isHidden) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			this.tick();
		}, delayMs);
	}

	async tick() {
		if (this.isStopped || this.isHidden) return;
		try {
			const version = await this.pollFn();
			this.consecutiveErrors = 0;
			if (typeof version === 'number') {
				if (this.lastVersion !== null && version !== this.lastVersion) {
					this.onVersionChange(version);
				}
				this.lastVersion = version;
			}
			if (!this.isStopped && !this.isHidden) {
				this.scheduleNext(this.baseIntervalMs);
			}
		} catch {
			this.consecutiveErrors++;
			const backoffDelay = Math.min(
				this.maxBackoffMs,
				this.baseIntervalMs * Math.pow(2, this.consecutiveErrors - 1)
			);
			if (!this.isStopped && !this.isHidden) {
				this.scheduleNext(backoffDelay);
			}
		}
	}
}

describe('ScanPollScheduler unit tests', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('polls periodically and triggers onVersionChange when dataVersion increments', async () => {
		let currentVersion = 1;
		const pollFn = vi.fn().mockImplementation(async () => currentVersion);
		const onVersionChange = vi.fn();

		const scheduler = new ScanPollScheduler({ pollFn, onVersionChange, baseIntervalMs: 3000 });
		scheduler.initVersion(1);
		scheduler.start();

		// Fast forward 3000ms -> first poll
		vi.advanceTimersByTime(3000);
		await Promise.resolve();
		expect(pollFn).toHaveBeenCalledTimes(1);
		expect(onVersionChange).not.toHaveBeenCalled();

		// Bump version
		currentVersion = 2;
		vi.advanceTimersByTime(3000);
		await Promise.resolve();
		expect(pollFn).toHaveBeenCalledTimes(2);
		expect(onVersionChange).toHaveBeenCalledWith(2);
	});

	it('pauses polling when hidden and polls immediately when visible', async () => {
		const pollFn = vi.fn().mockResolvedValue(1);
		const onVersionChange = vi.fn();

		const scheduler = new ScanPollScheduler({ pollFn, onVersionChange, baseIntervalMs: 3000 });
		scheduler.initVersion(1);
		scheduler.start();

		// Set hidden before timer fires
		scheduler.setVisibility(true);
		vi.advanceTimersByTime(10000);
		expect(pollFn).not.toHaveBeenCalled();

		// Becoming visible triggers immediate poll
		scheduler.setVisibility(false);
		await Promise.resolve();
		expect(pollFn).toHaveBeenCalledTimes(1);
	});

	it('backs off exponentially on consecutive errors up to maxBackoffMs', async () => {
		const pollFn = vi.fn().mockRejectedValue(new Error('Network error'));
		const onVersionChange = vi.fn();

		const scheduler = new ScanPollScheduler({
			pollFn,
			onVersionChange,
			baseIntervalMs: 3000,
			maxBackoffMs: 30000
		});
		scheduler.initVersion(1);
		scheduler.start();

		// Tick 1 after 3000ms: error 1 -> backoff = min(30000, 3000 * 2^0) = 3000ms
		vi.advanceTimersByTime(3000);
		await Promise.resolve();
		expect(pollFn).toHaveBeenCalledTimes(1);

		// Tick 2 after 3000ms: error 2 -> backoff = min(30000, 3000 * 2^1) = 6000ms
		vi.advanceTimersByTime(3000);
		await Promise.resolve();
		expect(pollFn).toHaveBeenCalledTimes(2);

		// Advance 3000ms: should NOT have polled yet because delay was 6000ms
		vi.advanceTimersByTime(3000);
		await Promise.resolve();
		expect(pollFn).toHaveBeenCalledTimes(2);

		// Advance remaining 3000ms (total 6000ms): error 3 -> backoff = 12000ms
		vi.advanceTimersByTime(3000);
		await Promise.resolve();
		expect(pollFn).toHaveBeenCalledTimes(3);
	});
});
