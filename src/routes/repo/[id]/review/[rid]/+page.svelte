<script lang="ts">
	import { base } from '$app/paths';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		SEVERITIES,
		SEV_LABEL,
		SEV_VAR,
		SEV_BG_VAR,
		countSeverities,
		quiets,
		fmtDur
	} from '$lib/format';
	import FindingCard from '$lib/components/FindingCard.svelte';
	import ReportSidebar from '$lib/components/ReportSidebar.svelte';
	import Time from '$lib/components/Time.svelte';
	import type { Finding, Severity, Triage } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const review = $derived(data.review);
	const repo = $derived(data.repo);
	const repoUrl = $derived(
		`https://github.com/${repo.path.split('/').map(encodeURIComponent).join('/')}`
	);

	// Keep on-page triage edits through filters and report navigation within a repo.
	const edits = new SvelteMap<string, Triage | null>();
	function triageOf(f: Finding): Triage | null {
		const e = edits.get(`${repo.id}:${f.fingerprint}`);
		return e !== undefined ? e : f.triage;
	}

	const openFindings = $derived(review.findings.filter((f) => !quiets(triageOf(f))));
	const counts = $derived(countSeverities(openFindings));
	const quietedCount = $derived(review.findings.length - openFindings.length);
	let selectedSeverity = $state<Severity | 'all'>('all');
	let showTriaged = $state(false);
	let nav: HTMLElement | undefined = $state();
	const eligibleFindings = $derived(showTriaged ? review.findings : openFindings);
	const filterCounts = $derived(countSeverities(eligibleFindings));
	const visibleFindings = $derived(
		eligibleFindings.filter((f) => selectedSeverity === 'all' || f.severity === selectedSeverity)
	);
	const visibleIds = $derived(new Set(visibleFindings.map((f) => f.fingerprint)));
	const activeId = $derived(page.url.hash.slice(1));
	const reportId = $derived(review.id);
	let revealVersion = 0;

	async function revealFinding(fingerprint: string) {
		const version = ++revealVersion;
		const reviewId = review.id;
		const finding = review.findings.find((f) => f.fingerprint === fingerprint);
		if (!finding) return;
		if (selectedSeverity !== 'all' && selectedSeverity !== finding.severity)
			selectedSeverity = 'all';
		if (quiets(triageOf(finding))) showTriaged = true;
		await tick();
		if (version !== revealVersion || review.id !== reviewId) return;
		const card = document.getElementById(fingerprint);
		const details = card?.querySelector('details');
		if (!card || !details) return;
		details.open = true;
		// Let native fragment scrolling and disclosure layout finish before positioning.
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		if (
			version !== revealVersion ||
			review.id !== reviewId ||
			page.url.hash !== `#${fingerprint}` ||
			!card.isConnected ||
			card.hidden
		) return;
		details.querySelector('summary')?.focus({ preventScroll: true });
		const headerHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 64;
		const stickyBottom = window.innerWidth < 900 && nav
			? Number.parseFloat(getComputedStyle(nav).top) + nav.offsetHeight
			: headerHeight;
		window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - stickyBottom - 20 });
	}

	async function pickFinding(fingerprint: string) {
		const reviewId = review.id;
		await goto(`#${fingerprint}`, { noScroll: true, keepFocus: true });
		if (review.id === reviewId && page.url.hash === `#${fingerprint}`)
			await revealFinding(fingerprint);
	}

	$effect(() => {
		const fingerprint = activeId;
		const currentReportId = reportId;
		untrack(() => {
			if (fingerprint && currentReportId) void revealFinding(fingerprint);
		});
	});

	afterNavigate(() => {
		const hash = page.url.hash;
		if (hash) void revealFinding(hash.slice(1));
	});

	function onTriageChanged(repoId: string, finding: Finding) {
		return async (triage: Triage | null, restoreFocus: boolean) => {
			const active = document.activeElement;
			const hadFocus = restoreFocus && (
				active === document.body || active?.closest('.finding')?.id === finding.fingerprint
			);
			edits.set(`${repoId}:${finding.fingerprint}`, triage);
			await tick();
			if (!hadFocus || repo.id !== repoId) return;
			if (!visibleIds.has(finding.fingerprint)) {
				nav?.querySelector<HTMLButtonElement>('.show-triaged')?.focus();
			} else {
				document.getElementById(finding.fingerprint)
					?.querySelector<HTMLButtonElement>('.ftriage button')?.focus();
			}
		};
	}

	// Without an agent summary, use only the review's reported data.
	const summaryText = $derived.by(() => {
		if (review.summary) return review.summary;
		const n = review.findings.length;
		const files = new Set(review.findings.flatMap((f) => f.locations.map((l) => l.file)).filter(Boolean))
			.size;
		const bySeverity = SEVERITIES.map((s) => {
			const c = review.findings.filter((f) => f.severity === s).length;
			return c > 0 ? `${c} ${SEV_LABEL[s].toLowerCase()}` : '';
		}).filter(Boolean);
		const parts = [
			n === 0
				? 'No findings'
				: `${n} finding${n === 1 ? '' : 's'} (${bySeverity.join(', ')})` +
					(files > 0 ? ` across ${files} file${files === 1 ? '' : 's'}` : '')
		];
		if (review.filesScanned > 0)
			parts.push(`${review.filesScanned.toLocaleString('en-US')} files scanned`);
		if (review.engine) parts.push(`engine ${review.engine}`);
		if (review.model) parts.push(`model ${review.model}`);
		return parts.join(' · ');
	});
</script>

<svelte:head><title>Hermes · {repo.id} {review.commit}</title></svelte:head>

<main>
	<a class="back mono" href="{base}/repo/{repo.id}">← {repo.id} reviews</a>

	<div class="report-layout">
		<aside class="report-nav" bind:this={nav} aria-label="Report navigation">
			<ReportSidebar
				counts={filterCounts}
				findings={visibleFindings}
				total={review.findings.length}
				{quietedCount}
				{selectedSeverity}
				{showTriaged}
				{activeId}
				onSeverity={(severity) => selectedSeverity = severity}
				onShowTriaged={(show) => showTriaged = show}
				onPick={pickFinding}
			/>
		</aside>
		<article class="report card">
			<!-- header -->
			<div class="rhead">
				<div class="badge">
					<div class="badge-ring"><span class="badge-dot"></span></div>
					<span class="mono"
						>Hermes Security Review{review.agentVersion ? ` · ${review.agentVersion}` : ''}</span
					>
				</div>
				<h1 class="display">Security Review Report</h1>
				<div class="rmeta mono">
					<span><span class="k">repository</span> <a class="source-link" href={repoUrl} target="_blank" rel="noopener noreferrer">{repo.path}<span class="visually-hidden"> (opens in new tab)</span></a></span>
					<span><span class="k">commit</span> <a class="commit" href="{repoUrl}/commit/{encodeURIComponent(review.commit)}" target="_blank" rel="noopener noreferrer">{review.commit}<span class="visually-hidden"> (opens in new tab)</span></a></span>
					{#if review.model}<span><span class="k">model</span> {review.model}</span>{/if}
					<span><span class="k">engine</span> {review.engine || '—'}</span>
					<span><span class="k">trigger</span> {review.trigger || '—'}</span>
					<span><span class="k">generated</span> <Time ts={review.createdAt} /></span>
					<span><span class="k">duration</span> {fmtDur(review.durationSecs)}</span>
					<span><span class="k">lines</span> {review.lines.toLocaleString('en-US')}</span>
				</div>
			</div>

			<!-- summary band -->
			<div class="band">
				<div class="band-cell">
					<div class="bl">Critical</div>
					<div class="bn display" style="color:var(--crit)">{counts.crit}</div>
				</div>
				<div class="band-cell">
					<div class="bl">High</div>
					<div class="bn display" style="color:var(--high)">{counts.high}</div>
				</div>
				<div class="band-cell">
					<div class="bl">Medium</div>
					<div class="bn display" style="color:var(--med)">{counts.med}</div>
				</div>
				<div class="band-cell">
					<div class="bl">Low</div>
					<div class="bn display" style="color:var(--low)">{counts.low}</div>
				</div>
			</div>

			<!-- exec summary -->
			<div class="section">
				{#if quietedCount > 0}
					<div class="qnote mono">
						{quietedCount} finding{quietedCount > 1 ? 's' : ''} excluded from actionable
						counts (false positive / accepted risk). Use “Show triaged” to include them in the list.
					</div>
				{/if}
				<div class="slabel mono">Summary</div>
				<p class="summary">{summaryText}</p>
			</div>

			<!-- diff vs previous run -->
			{#if review.hasPrev}
				<div class="diff">
					<span class="mono diff-k">Change since <a class="commit" href="{repoUrl}/commit/{encodeURIComponent(review.prevCommit ?? '')}" target="_blank" rel="noopener noreferrer">{review.prevCommit}<span class="visually-hidden"> (opens in new tab)</span></a></span>
					<span class="diff-stat"
						><span class="display dn" style="color:var(--high)">+{review.diff.newCount}</span> new</span
					>
					<span class="diff-stat"
						><span class="display dn" style="color:var(--text)">{review.diff.carriedCount}</span> still open</span
					>
					<span class="diff-stat"
						><span class="display dn" style="color:var(--accent)">−{review.diff.resolvedCount}</span> resolved</span
					>
				</div>
			{/if}

			<!-- findings -->
			<section class="findings" id="report-findings" aria-labelledby="findings-heading">
				<h2 class="slabel mono" id="findings-heading">Findings</h2>
				{#if review.findings.length === 0}
					<p class="noissues mono">No findings at this commit — repository is clean. ✓</p>
				{:else if visibleFindings.length === 0}
					<p class="noissues mono">No findings match these filters. Choose All or show triaged findings.</p>
				{/if}
				<div class="flist">
					{#key review.id}
						{#each review.findings as f (f.fingerprint)}
							<FindingCard
								finding={f}
								triage={triageOf(f)}
								repoId={repo.id}
								{repoUrl}
								commit={review.commit}
								hidden={!visibleIds.has(f.fingerprint)}
								onChanged={onTriageChanged(repo.id, f)}
							/>
						{/each}
					{/key}
				</div>

				<!-- resolved -->
				{#if review.resolved.length > 0}
					<div class="resolved">
						<div class="slabel mono accent">
							<span class="rdot" aria-hidden="true"></span>Resolved since {review.prevCommit}
						</div>
						<div class="rlist">
							{#each review.resolved as rf, i (i)}
								<div class="ritem">
									<span class="rcheck" aria-hidden="true">✓</span>
									<span
										class="fpill sm"
										style="--c:{SEV_VAR[rf.severity]};--b:{SEV_BG_VAR[rf.severity]}"
										aria-label="{SEV_LABEL[rf.severity]}"
										>{SEV_LABEL[rf.severity]}</span
									>
									<span class="rtitle">{rf.title}</span>
									<span class="mono rfile">{rf.file}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- optional agent-submitted HTML body (sanitized server-side on submit) -->
				{#if review.html}
					<div class="agent-html">
						<div class="slabel mono">Full report as submitted</div>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via sanitize-html at ingest -->
						<div class="agent-html-body">{@html review.html}</div>
					</div>
				{/if}

				<div class="scope mono">
					<div>
						report generated automatically by Hermes · findings should be triaged by a human reviewer
						before remediation
					</div>
				</div>
			</section>
		</article>
	</div>
</main>

<style>
	main {
		padding-top: 26px;
		padding-bottom: 26px;
	}
	.report-layout {
		display: grid;
		grid-template-columns: 240px minmax(0, 760px);
		align-items: start;
		gap: 28px;
	}
	.report-nav {
		position: sticky;
		top: 84px;
		z-index: 20;
		min-width: 0;
	}
	.report {
		min-width: 0;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: var(--dim);
		margin-bottom: 20px;
		transition: color 0.15s;
	}
	.back:hover {
		color: var(--accent);
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 18px;
		overflow: hidden;
	}

	.rhead {
		padding: 26px 30px;
		border-bottom: 1px solid var(--border);
		background: var(--bg2);
	}
	.badge {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-bottom: 14px;
	}
	.badge-ring {
		position: relative;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid var(--accent);
		flex: none;
	}
	.badge-dot {
		position: absolute;
		width: 7px;
		height: 7px;
		left: 8px;
		top: 0;
		border-radius: 50%;
		background: var(--accent);
	}
	.badge span {
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent);
	}
	h1 {
		margin: 0;
		font-weight: 700;
		font-size: 24px;
		color: var(--text);
	}
	.rmeta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 26px;
		margin-top: 14px;
		font-size: 12px;
		color: var(--dim);
	}
	.k {
		color: var(--faint);
	}
	.commit,
	.source-link {
		color: var(--accent2);
	}
	.commit:hover,
	.source-link:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.band {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1px;
		background: var(--border);
	}
	.band-cell {
		background: var(--surface);
		padding: 18px 22px;
	}
	.bl {
		font-size: 11px;
		color: var(--faint);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.bn {
		font-weight: 700;
		font-size: 28px;
	}

	.section {
		padding: 24px 30px;
		border-top: 1px solid var(--border);
	}
	.slabel {
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
		margin-bottom: 10px;
	}
	h2.slabel {
		font-weight: 500;
	}
	.summary {
		margin: 0;
		font-size: 15px;
		line-height: 1.65;
		color: var(--dim);
	}
	.qnote {
		margin: 0 0 16px;
		font-size: 12px;
		color: var(--faint);
		line-height: 1.5;
	}

	.diff {
		display: flex;
		align-items: center;
		gap: 20px;
		flex-wrap: wrap;
		padding: 15px 30px;
		border-top: 1px solid var(--border);
		background: var(--bg2);
	}
	.diff-k {
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.diff-stat {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 13px;
		color: var(--dim);
	}
	.dn {
		font-weight: 700;
		font-size: 18px;
	}

	.findings {
		padding: 6px 30px 30px;
	}
	.findings .slabel {
		margin: 10px 0 16px;
	}
	.noissues {
		font-size: 13px;
		color: var(--accent);
	}
	.flist {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.fpill {
		display: inline-flex;
		align-items: center;
		padding: 4px 10px;
		border-radius: 6px;
		font-family: 'IBM Plex Mono', monospace;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		background: var(--b);
		color: var(--c);
		white-space: nowrap;
	}
	.fpill.sm {
		padding: 3px 8px;
		font-size: 10px;
		letter-spacing: 0.05em;
	}

	.resolved {
		margin-top: 22px;
	}
	.accent {
		color: var(--accent);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.rdot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}
	.rlist {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ritem {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border: 1px dashed var(--border2);
		border-radius: 12px;
	}
	.rcheck {
		color: var(--accent);
		font-size: 14px;
		flex: none;
	}
	.rtitle {
		font-size: 14px;
		color: var(--dim);
		text-decoration: line-through;
		flex: 1;
		min-width: 0;
	}
	.rfile {
		font-size: 12px;
		color: var(--faint);
		white-space: nowrap;
	}

	.agent-html {
		margin-top: 24px;
		padding-top: 18px;
		border-top: 1px solid var(--border);
	}
	.agent-html-body {
		font-size: 14px;
		line-height: 1.65;
		color: var(--dim);
	}
	.agent-html-body :global(h1),
	.agent-html-body :global(h2),
	.agent-html-body :global(h3) {
		color: var(--text);
		font-family: 'Space Grotesk', sans-serif;
	}
	.agent-html-body :global(pre),
	.agent-html-body :global(code) {
		font-family: 'IBM Plex Mono', monospace;
		background: var(--surface2);
		border-radius: 6px;
	}
	.agent-html-body :global(pre) {
		padding: 12px 14px;
		overflow-x: auto;
		border: 1px solid var(--border);
	}
	.agent-html-body :global(a) {
		color: var(--accent2);
	}

	.scope {
		margin-top: 24px;
		padding-top: 18px;
		border-top: 1px solid var(--border);
		font-size: 11px;
		color: var(--faint);
		line-height: 1.7;
	}

	@media (max-width: 899px) {
		.report-layout {
			grid-template-columns: minmax(0, 760px);
			justify-content: center;
			gap: 18px;
		}
		.report-nav {
			top: 68px;
		}
	}
	@media (max-width: 560px) {
		.rhead,
		.section,
		.diff,
		.findings {
			padding-left: 18px;
			padding-right: 18px;
		}
	}
</style>
