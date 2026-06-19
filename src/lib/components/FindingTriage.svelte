<script lang="ts">
	import { base } from '$app/paths';
	import { TRIAGE_STATUSES, TRIAGE_LABEL } from '$lib/format';
	import type { Triage, TriageStatus } from '$lib/types';

	let {
		repoId,
		fingerprint,
		current,
		onChanged
	}: {
		repoId: string;
		fingerprint: string;
		current: Triage | null;
		onChanged: (t: Triage | null) => void;
	} = $props();

	let open = $state(false);
	let busy = $state(false);
	let err = $state('');
	let note = $state('');

	function toggle() {
		if (!open) {
			note = current?.note ?? '';
			err = '';
		}
		open = !open;
	}

	// PUT the verdict (or clear it), then hand the result up so the page's overlay —
	// the single source of truth for display — updates without a reload.
	async function apply(status: TriageStatus | 'open') {
		if (busy) return;
		busy = true;
		err = '';
		try {
			const res = await fetch(`${base}/api/repos/${repoId}/findings/${fingerprint}/triage`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status, note: note.trim() })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				err = body.error ?? `failed (${res.status})`;
				return;
			}
			if (status === 'open') {
				onChanged(null);
			} else {
				const now = Date.now();
				onChanged({
					status,
					note: note.trim(),
					createdAt: current?.createdAt ?? now,
					updatedAt: now
				});
			}
			open = false;
		} catch {
			err = 'network error';
		} finally {
			busy = false;
		}
	}
</script>

<div class="triage">
	<button class="trigger mono" class:active={open} onclick={toggle}>
		{current ? 'Edit triage' : 'Triage'} ▾
	</button>

	{#if open}
		<div class="panel">
			<textarea
				class="note"
				bind:value={note}
				rows="2"
				placeholder="Justification (recommended for dismissals)"
			></textarea>
			<div class="actions">
				{#each TRIAGE_STATUSES as s (s)}
					<button
						class="set {s}"
						class:active={current?.status === s}
						disabled={busy}
						onclick={() => apply(s)}
					>
						{TRIAGE_LABEL[s]}
					</button>
				{/each}
				{#if current}
					<button class="clear" disabled={busy} onclick={() => apply('open')}>Clear</button>
				{/if}
			</div>
			{#if err}<div class="err mono">{err}</div>{/if}
		</div>
	{/if}
</div>

<style>
	.triage {
		position: relative;
		display: inline-block;
	}
	.trigger {
		background: transparent;
		border: 1px solid var(--border2);
		color: var(--faint);
		border-radius: 7px;
		padding: 4px 10px;
		font-size: 11px;
		cursor: pointer;
		transition:
			color 0.12s,
			border-color 0.12s;
	}
	.trigger:hover,
	.trigger.active {
		color: var(--accent);
		border-color: var(--accent);
	}

	.panel {
		margin-top: 8px;
		width: min(340px, 78vw);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.note {
		width: 100%;
		resize: vertical;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 8px 10px;
		font-size: 12.5px;
		color: var(--text);
		font-family: inherit;
	}
	.note:focus {
		outline: none;
		border-color: var(--accent);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.set,
	.clear {
		border-radius: 6px;
		padding: 5px 9px;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid var(--border2);
		background: var(--surface2);
		color: var(--dim);
		transition:
			color 0.12s,
			border-color 0.12s;
	}
	.set:hover:not(:disabled),
	.clear:hover:not(:disabled) {
		color: var(--text);
	}
	.set.active {
		border-color: currentColor;
	}
	.set.acknowledged.active {
		color: var(--accent2);
	}
	.set.false_positive.active {
		color: var(--faint);
	}
	.set.accepted_risk.active {
		color: var(--med);
	}
	.clear {
		margin-left: auto;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.err {
		color: var(--crit);
		font-size: 11px;
	}
</style>
