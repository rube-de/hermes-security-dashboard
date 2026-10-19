<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SEV_LABEL, SEV_VAR, SEV_BG_VAR, TRIAGE_LABEL, quiets } from '$lib/format';
	import { issuePrompt } from '$lib/issue-prompt';
	import type { Finding, Triage } from '$lib/types';
	import FindingTriage from './FindingTriage.svelte';
	import Time from './Time.svelte';

	let {
		finding,
		triage,
		repoId,
		repoUrl,
		commit,
		hidden,
		onChanged
	}: {
		finding: Finding;
		triage: Triage | null;
		repoId: string;
		repoUrl: string;
		commit: string;
		hidden: boolean;
		onChanged: (t: Triage | null, restoreFocus: boolean) => void;
	} = $props();

	// Snapshot the default once; native toggles preserve disclosure through filter/triage edits.
	let expanded = $state(untrack(() => finding.isNew && !triage));
	const sourceBase = $derived(`${repoUrl}/blob/${encodeURIComponent(commit)}/`);
	const cweNumber = $derived(/^CWE-(\d+)$/i.exec(finding.cwe)?.[1]);
	const lifeText = $derived(
		finding.isNew
			? 'New this run'
			: `Carried · open ${finding.openRuns} run${finding.openRuns === 1 ? '' : 's'} (${finding.ageHours}h)`
	);
	let copyStatus = $state('');
	let copyFailed = $state(false);

	async function copyLink() {
		copyStatus = '';
		copyFailed = false;
		const url = new URL(window.location.href);
		url.hash = finding.fingerprint;
		try {
			await navigator.clipboard.writeText(url.href);
			copyStatus = 'Link copied';
		} catch {
			copyFailed = true;
			copyStatus = 'Could not copy. Copy the finding link instead.';
		}
	}

	// Derived values are lazy: built only when copied or previewed.
	const prompt = $derived(issuePrompt(finding, repoUrl, commit));
	let promptOpen = $state(false);
	let promptEl = $state<HTMLTextAreaElement>();

	async function copyPrompt() {
		copyStatus = '';
		copyFailed = false;
		try {
			await navigator.clipboard.writeText(prompt);
			copyStatus = 'Prompt copied';
		} catch {
			// No clipboard (plain HTTP, denied permission): show the prompt selected for manual copy.
			promptOpen = true;
			await tick();
			promptEl?.focus();
			promptEl?.select();
			copyStatus = 'Could not copy. The prompt is shown and selected: press Ctrl+C (⌘C on Mac).';
		}
	}
</script>

<article
	class="finding"
	class:quieted={quiets(triage)}
	id={finding.fingerprint}
	{hidden}
	style="--severity:{SEV_VAR[finding.severity]};--severity-bg:{SEV_BG_VAR[finding.severity]}"
	aria-labelledby="finding-title-{finding.fingerprint}"
>
	<div class="fmeta">
		<span class="fpill mono" aria-label={SEV_LABEL[finding.severity]}>{SEV_LABEL[finding.severity]}</span>
		<span class="life mono" class:new={finding.isNew}>{lifeText}</span>
		{#if triage}<span class="tflag mono {triage.status}">{TRIAGE_LABEL[triage.status]}</span>{/if}
		<span class="copy-actions">
			<span class="split">
				<button
					type="button"
					class="copy mono"
					aria-label="Copy coding-agent prompt for {finding.title}"
					onclick={copyPrompt}>Copy prompt</button
				>
				<button
					type="button"
					class="copy toggle mono"
					aria-label="Prompt preview for {finding.title}"
					aria-expanded={promptOpen}
					aria-controls="prompt-{finding.fingerprint}"
					onclick={() => (promptOpen = !promptOpen)}
					><span class="toggle-icon" class:open={promptOpen} aria-hidden="true">⌄</span></button
				>
			</span>
			<button
				type="button"
				class="copy mono"
				aria-label="Copy link to {finding.title}"
				onclick={copyLink}>Copy link</button
			>
		</span>
	</div>

	{#if promptOpen}
		<div class="prompt" id="prompt-{finding.fingerprint}">
			<label class="prompt-label mono" for="prompt-text-{finding.fingerprint}">Issue prompt</label>
			<textarea
				class="mono"
				id="prompt-text-{finding.fingerprint}"
				readonly
				rows="12"
				spellcheck="false"
				bind:this={promptEl}
				value={prompt}
			></textarea>
		</div>
	{/if}

	<details bind:open={expanded}>
		<summary>
			<h3 class="display" id="finding-title-{finding.fingerprint}">
				<span class="chevron" aria-hidden="true">›</span><span>{finding.title}</span>
			</h3>
		</summary>
		<div class="fcontent">
			<p class="fdesc">{finding.description}</p>
			{#if finding.code}<pre class="fcode mono">{finding.code}</pre>{/if}
			<div class="frec">
				<span class="arrow" aria-hidden="true">→</span>
				<div><strong>Recommendation.</strong> {finding.recommendation}</div>
			</div>
			{#if triage}
				<div class="triage-info mono">
					<span>Triaged by <strong>{triage.triagedBy || 'unknown'}</strong></span>
					<Time ts={triage.updatedAt || triage.createdAt} mode="ago" />
					{#if triage.note}<span class="triage-note">“{triage.note}”</span>{/if}
				</div>
			{/if}
			<div class="ftriage">
				<FindingTriage
					{repoId}
					fingerprint={finding.fingerprint}
					severity={finding.severity}
					current={triage}
					{onChanged}
				/>
			</div>
		</div>
	</details>

	<div class="references mono">
		{#if finding.cwe}
			{#if cweNumber}
				<a href="https://cwe.mitre.org/data/definitions/{cweNumber}.html" target="_blank" rel="noopener noreferrer">
					{finding.cwe}<span class="visually-hidden"> (opens in new tab)</span>
				</a>
			{:else}<span>{finding.cwe}</span>{/if}
		{/if}
		<span class="locations">
			{#if finding.locations.length > 1}<span>{finding.locations.length} locations:</span>{/if}
			{#each finding.locations as location, i (i)}
				<span class="location">
					{#if location.file}
						<a
							href="{sourceBase}{location.file.split('/').map(encodeURIComponent).join('/')}{location.line > 0 ? `#L${location.line}` : ''}"
							target="_blank"
							rel="noopener noreferrer"
						>
							{location.file}{location.line > 0 ? `:${location.line}` : ''}<span class="visually-hidden"> (opens in new tab)</span>
						</a>
					{:else}
						<span>Location not reported</span>
					{/if}
					{#if location.locationKey}<span class="symbol">{location.locationKey}</span>{/if}
				</span>
			{/each}
		</span>
	</div>
	<div class="copy-status mono" role="status">
		{copyStatus}
		{#if copyFailed}<a href="#{finding.fingerprint}">Finding link</a>{/if}
	</div>
</article>

<style>
	.finding {
		border: 1px solid var(--border2);
		border-left: 3px solid var(--severity);
		border-radius: 12px;
		padding: 18px 20px;
		background: var(--bg2);
		min-width: 0;
		scroll-margin-top: 90px;
	}
	.finding[hidden] {
		display: none;
	}
	.finding:target {
		border-color: var(--accent);
	}
	.finding.quieted {
		border-left-style: dashed;
	}
	.fmeta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 10px;
	}
	.fpill {
		padding: 4px 8px;
		border-radius: 5px;
		background: var(--severity-bg);
		color: var(--severity);
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
	}
	.life,
	.tflag {
		padding: 3px 7px;
		border-radius: 5px;
		font-size: 10px;
		background: var(--surface2);
		color: var(--faint);
	}
	.life.new {
		background: var(--highB);
		color: var(--high);
	}
	.tflag.acknowledged {
		color: var(--accent2);
	}
	.tflag.accepted_risk {
		background: var(--medB);
		color: var(--med);
	}
	.copy-actions {
		display: flex;
		gap: 8px;
		margin-left: auto;
	}
	.copy {
		border: 1px solid var(--border2);
		border-radius: 6px;
		padding: 5px 8px;
		font-size: 11px;
		color: var(--dim);
		background: var(--surface);
		cursor: pointer;
	}
	.copy:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
	.split {
		display: flex;
	}
	.split .copy:first-child {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.split .toggle {
		margin-left: -1px;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		padding: 5px 6px;
	}
	.toggle[aria-expanded='true'] {
		color: var(--accent);
		border-color: var(--accent);
	}
	.toggle-icon {
		display: inline-block;
		line-height: 1;
		transition: transform 0.15s;
	}
	.toggle-icon.open {
		transform: rotate(180deg);
	}
	.prompt {
		margin-bottom: 12px;
	}
	.prompt-label {
		display: block;
		margin-bottom: 6px;
		font-size: 10px;
		text-transform: uppercase;
		color: var(--faint);
	}
	.prompt textarea {
		box-sizing: border-box;
		width: 100%;
		resize: vertical;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface2);
		color: var(--text);
		font-size: 11.5px;
		line-height: 1.55;
	}
	summary {
		cursor: pointer;
		list-style: none;
		border-radius: 4px;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	h3 {
		display: flex;
		gap: 8px;
		margin: 0;
		font-size: 16px;
		line-height: 1.45;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.chevron {
		flex: none;
		color: var(--faint);
		font-family: sans-serif;
		font-size: 22px;
		line-height: 1;
		transition: transform 0.15s;
	}
	details[open] .chevron {
		transform: rotate(90deg);
	}
	.fcontent {
		padding-top: 12px;
	}
	.fdesc {
		margin: 0 0 12px;
		font-size: 14px;
		line-height: 1.65;
		color: var(--dim);
	}
	.fcode {
		margin: 0 0 12px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 13px 15px;
		font-size: 12px;
		line-height: 1.6;
		overflow-x: auto;
		white-space: pre;
	}
	.frec {
		display: flex;
		gap: 9px;
		padding: 11px 14px;
		border-radius: 8px;
		background: var(--accentB);
		border: 1px solid var(--accent);
		font-size: 13.5px;
		line-height: 1.55;
	}
	.frec strong,
	.arrow {
		color: var(--accent);
	}
	.arrow {
		flex: none;
	}
	.ftriage {
		margin-top: 12px;
	}
	.triage-info {
		margin-top: 12px;
		padding: 8px 10px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 11.5px;
		color: var(--dim);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		overflow-wrap: anywhere;
	}
	.triage-info strong {
		color: var(--text);
		font-weight: 600;
	}
	.triage-note {
		width: 100%;
		color: var(--text);
	}
	.references {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px 16px;
		margin-top: 12px;
		font-size: 11px;
		color: var(--faint);
		overflow-wrap: anywhere;
	}
	.references a,
	.copy-status a {
		color: var(--accent2);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.locations,
	.location {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
		min-width: 0;
	}
	.symbol {
		color: var(--dim);
	}
	.copy-status {
		font-size: 11px;
		color: var(--dim);
	}
	.copy-status:not(:empty) {
		margin-top: 10px;
	}
	@media (max-width: 560px) {
		.finding {
			padding: 14px;
		}
		.copy-actions {
			margin-left: 0;
		}
		h3 {
			font-size: 15px;
		}
		.fcode {
			padding: 10px;
			font-size: 11px;
		}
		.frec {
			padding: 10px;
		}
	}
</style>
