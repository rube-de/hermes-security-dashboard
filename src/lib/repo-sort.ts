import { SEVERITIES } from '$lib/format';
import type { RepoSummary } from '$lib/types';

export type RepoSortColumn = 'repository' | 'risk' | 'findings' | 'oldest';
export type RepoSortDirection = 'ascending' | 'descending';

function severityRank(repo: RepoSummary): number {
	const rank = SEVERITIES.findIndex((severity) => repo.counts[severity] > 0);
	return rank < 0 ? SEVERITIES.length : rank;
}

function compareOldest(a: RepoSummary, b: RepoSummary, direction: RepoSortDirection): number {
	if (a.oldestOpenAt === null && b.oldestOpenAt === null) return 0;
	if (a.oldestOpenAt === null) return 1;
	if (b.oldestOpenAt === null) return -1;
	return direction === 'descending'
		? a.oldestOpenAt - b.oldestOpenAt
		: b.oldestOpenAt - a.oldestOpenAt;
}

function compareRisk(a: RepoSummary, b: RepoSummary): number {
	const rankDiff = severityRank(a) - severityRank(b);
	if (rankDiff !== 0) return rankDiff;

	const countDiff = b.counts.crit + b.counts.high - (a.counts.crit + a.counts.high);
	if (countDiff !== 0) return countDiff;

	return compareOldest(a, b, 'descending');
}

/** Highest risk first by default; age sorts keep repos without open crit/high last. */
export function compareRepos(
	a: RepoSummary,
	b: RepoSummary,
	column: RepoSortColumn = 'risk',
	direction: RepoSortDirection = 'descending'
): number {
	let diff: number;
	switch (column) {
		case 'repository':
			return direction === 'ascending'
				? a.id.localeCompare(b.id, 'en')
				: b.id.localeCompare(a.id, 'en');
		case 'risk':
			diff = direction === 'descending' ? compareRisk(a, b) : -compareRisk(a, b);
			break;
		case 'findings':
			diff =
				(direction === 'descending'
					? b.counts.total - a.counts.total
					: a.counts.total - b.counts.total) || compareRisk(a, b);
			break;
		case 'oldest':
			diff = compareOldest(a, b, direction);
			break;
	}
	return diff || a.id.localeCompare(b.id, 'en');
}
