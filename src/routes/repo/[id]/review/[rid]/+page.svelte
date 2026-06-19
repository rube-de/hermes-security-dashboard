<script lang="ts">
	import { base } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import { SEV_LABEL, SEV_VAR, SEV_BG_VAR, TRIAGE_LABEL } from '$lib/format';
	import FindingTriage from '$lib/components/FindingTriage.svelte';
	import type { Triage } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const review = $derived(data.review);
	const repo = $derived(data.repo);

	// Optimistic overlay of triage edits made on this page, keyed by fingerprint.
	// triageOf() reads this first, falling back to the server-loaded verdict, so a
	// just-applied tag renders immediately without a reload — one source of truth.
	const edits = new SvelteMap<string, Triage | null>();
	function triageOf(f: PageData['review']['findings'][number]): Triage | null {
		const e = edits.get(f.fingerprint);
		return e !== undefined ? e : f.triage;
	}
	function isDismissed(t: Triage | null): boolean {
		return !!t && (t.status === 'false_positive' || t.status === 'accepted_risk');
	}

	const summaryText = $derived(
		review.summary ||
			`Hermes completed a static and LLM-assisted review of ${repo.id} at commit ${review.commit}, ` +
				`covering ${review.lines.toLocaleString('en-US')} lines across ${review.filesScanned} files. ` +
				`The findings below are ordered by severity. Each includes the affected location, an impact ` +
				`assessment, and a recommended remediation.`
	);

	function lifeText(f: PageData['review']['findings'][number]) {
		if (f.isNew) return 'New this run';
		const runs = `${f.openRuns} run${f.openRuns > 1 ? 's' : ''}`;
		return `Carried · open ${runs} (${f.ageHours}h)`;
	}
</script>

<svelte:head><title>Hermes · {repo.id} {review.commit}</title></svelte:head>

<main>
	<a class="back mono" href="{base}/repo/{repo.id}">← {repo.id} reviews</a>

	<article class="report card">
		<!-- header -->
		<div class="rhead">
			<div class="badge">
				<div class="badge-ring"><span class="badge-dot"></span></div>
				<span class="mono">Hermes Security Review · hermes v2.4.1</span>
			</div>
			<h1 class="display">Security Review Report</h1>
			<div class="rmeta mono">
				<span><span class="k">repository</span> {repo.path}</span>
				<span><span class="k">commit</span> <span class="commit">{review.commit}</span></span>
				{#if review.model}<span><span class="k">model</span> {review.model}</span>{/if}
				<span><span class="k">generated</span> {review.dateLabel}</span>
				<span><span class="k">duration</span> {review.durationLabel}</span>
				<span><span class="k">lines</span> {review.lines.toLocaleString('en-US')}</span>
			</div>
		</div>

		<!-- summary band -->
		<div class="band">
			<div class="band-cell">
				<div class="bl">Critical</div>
				<div class="bn display" style="color:var(--crit)">{review.counts.crit}</div>
			</div>
			<div class="band-cell">
				<div class="bl">High</div>
				<div class="bn display" style="color:var(--high)">{review.counts.high}</div>
			</div>
			<div class="band-cell">
				<div class="bl">Medium</div>
				<div class="bn display" style="color:var(--med)">{review.counts.med}</div>
			</div>
			<div class="band-cell">
				<div class="bl">Low</div>
				<div class="bn display" style="color:var(--low)">{review.counts.low}</div>
			</div>
		</div>

		<!-- exec summary -->
		<div class="section">
			{#if review.quietedCount > 0}
				<div class="qnote mono">
					{review.quietedCount} finding{review.quietedCount > 1 ? 's' : ''} triaged out of the
					counts above (false-positive / accepted-risk) — still listed below, dimmed.
				</div>
			{/if}
			<div class="slabel mono">Summary</div>
			<p class="summary">{summaryText}</p>
		</div>

		<!-- diff vs previous run -->
		{#if review.hasPrev}
			<div class="diff">
				<span class="mono diff-k">Change since <span class="commit">{review.prevCommit}</span></span>
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
		<div class="findings">
			<div class="slabel mono">Findings</div>
			{#if review.findings.length === 0}
				<p class="noissues mono">No findings at this commit — repository is clean. ✓</p>
			{/if}
			<div class="flist">
				{#each review.findings as f (f.fingerprint)}
					{@const t = triageOf(f)}
					<div class="finding" class:dismissed={isDismissed(t)}>
						<div class="fbar" style="background:{SEV_VAR[f.severity]}"></div>
						<div class="fbody">
							<div class="frow">
								<span
									class="fpill"
									style="--c:{SEV_VAR[f.severity]};--b:{SEV_BG_VAR[f.severity]}"
									>{SEV_LABEL[f.severity]}</span
								>
								<span class="mono fcwe">{f.cwe}</span>
								<span class="life mono" class:new={f.isNew}>{lifeText(f)}</span>
								{#if t}<span class="tflag {t.status}">{TRIAGE_LABEL[t.status]}</span>{/if}
								<span class="mono floc">{f.file}:{f.line}</span>
							</div>
							<div class="ftitle display">{f.title}</div>
							<div class="fdesc">{f.description}</div>
							{#if f.code}
								<pre class="fcode mono">{f.code}</pre>
							{/if}
							<div class="frec">
								<span class="arrow">→</span>
								<div><strong class="reck">Recommendation.</strong> {f.recommendation}</div>
							</div>
							<div class="ftriage">
								<FindingTriage
									repoId={repo.id}
									fingerprint={f.fingerprint}
									current={t}
									onChanged={(nt) => edits.set(f.fingerprint, nt)}
								/>
							</div>
						</div>
					</div>
				{/each}
			</div>

			<!-- resolved -->
			{#if review.resolved.length > 0}
				<div class="resolved">
					<div class="slabel mono accent">
						<span class="rdot"></span>Resolved since {review.prevCommit}
					</div>
					<div class="rlist">
						{#each review.resolved as rf, i (i)}
							<div class="ritem">
								<span class="rcheck">✓</span>
								<span class="fpill sm" style="--c:{SEV_VAR[rf.severity]};--b:{SEV_BG_VAR[rf.severity]}"
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
				<div>scope · static analysis (slither, semgrep) + LLM contextual review</div>
				<div>
					report generated automatically by Hermes · findings should be triaged by a human reviewer
					before remediation
				</div>
			</div>
		</div>
	</article>
</main>

<style>
	main {
		max-width: 920px;
		margin: 0 auto;
		padding: 26px;
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
	.commit {
		color: var(--accent2);
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
	.finding {
		display: flex;
		gap: 14px;
		border: 1px solid var(--border);
		border-radius: 14px;
		padding: 18px 20px;
		background: var(--bg2);
	}
	.fbar {
		width: 3px;
		border-radius: 3px;
		flex: none;
	}
	.fbody {
		flex: 1;
		min-width: 0;
	}
	.frow {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 10px;
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
	.fcwe {
		font-size: 11px;
		color: var(--faint);
	}
	.life {
		display: inline-flex;
		align-items: center;
		padding: 3px 8px;
		border-radius: 5px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		background: var(--surface2);
		color: var(--faint);
		white-space: nowrap;
	}
	.life.new {
		background: var(--highB);
		color: var(--high);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.floc {
		font-size: 12px;
		color: var(--accent2);
		margin-left: auto;
	}
	.tflag {
		display: inline-flex;
		align-items: center;
		padding: 3px 8px;
		border-radius: 5px;
		font-family: 'IBM Plex Mono', monospace;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.tflag.acknowledged {
		background: var(--surface2);
		color: var(--accent2);
	}
	.tflag.false_positive {
		background: var(--surface2);
		color: var(--faint);
	}
	.tflag.accepted_risk {
		background: var(--medB);
		color: var(--med);
	}
	.ftriage {
		margin-top: 12px;
	}
	.finding.dismissed {
		opacity: 0.5;
		transition: opacity 0.15s;
	}
	.finding.dismissed:hover {
		opacity: 1;
	}
	.ftitle {
		font-weight: 600;
		font-size: 16px;
		color: var(--text);
		margin-bottom: 8px;
	}
	.fdesc {
		font-size: 14px;
		line-height: 1.6;
		color: var(--dim);
		margin-bottom: 12px;
	}
	.fcode {
		margin: 0 0 12px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 9px;
		padding: 13px 15px;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--text);
		overflow-x: auto;
		white-space: pre;
	}
	.frec {
		display: flex;
		gap: 9px;
		align-items: flex-start;
		padding: 11px 14px;
		border-radius: 9px;
		background: var(--accentB);
		border: 1px solid var(--accent);
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--text);
	}
	.arrow {
		color: var(--accent);
		font-weight: 700;
		font-size: 13px;
		flex: none;
	}
	.reck {
		color: var(--accent);
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

	@media (max-width: 560px) {
		.rhead,
		.section,
		.diff,
		.findings {
			padding-left: 18px;
			padding-right: 18px;
		}
		.floc {
			margin-left: 0;
		}
	}
</style>
