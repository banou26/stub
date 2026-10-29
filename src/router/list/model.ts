// The My list page as data: its tabs and their counts, the title filter and the sorts, and what a + writes.
// Pure but for tracking's own rules, so it is pinned under vitest.

import type { CompactTracking, Fields } from '../../tracking/compact'

import { patchFor, rowOf, targetOf } from '../../tracking/compact'

/** One work on the lists, as the page reads it off `viewerLists`. */
export type ListedRow = CompactTracking & {
  uri: string
  episodeCount?: number | null
  summary: {
    status?: string | null
    progress?: number | null
    score?: number | null
    episodeCount?: number | null
    updatedAt?: string | null
    title?: string | null
  }
}

/** The tabs, in their order. Watching holds Rewatching too, and All every row. */
export const TABS = ['WATCHING', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED', 'ALL'] as const
export type Tab = typeof TABS[number]

/** The tab a status files a row under, or none but All for a row with no status. */
export const tabOf = (status: string | null | undefined): Tab | undefined =>
  status === 'REWATCHING' ? 'WATCHING'
  : status && status !== 'ALL' && (TABS as readonly string[]).includes(status) ? status as Tab
  : undefined

export const tabCounts = (rows: readonly ListedRow[]): Record<Tab, number> => {
  const counts = Object.fromEntries(TABS.map(tab => [tab, 0])) as Record<Tab, number>
  for (const row of rows) {
    counts.ALL++
    const tab = tabOf(row.summary.status)
    if (tab) counts[tab]++
  }
  return counts
}

export const SORTS = ['updated', 'title', 'score', 'progress'] as const
export type Sort = typeof SORTS[number]

const numberOf = (row: ListedRow, sort: Exclude<Sort, 'title'>) => {
  const value = sort === 'updated' ? Date.parse(row.summary.updatedAt ?? '') : sort === 'score' ? row.summary.score : row.summary.progress
  return value == null || Number.isNaN(value) ? undefined : value
}

/**
 * The rows of `tab` whose title holds `term`, in `sort`'s order: most recently updated, highest scored or
 * furthest watched first, titles A to Z. A row with no value for the sort goes last whichever it is, and a
 * tie goes by title.
 */
export const shownRows = <R extends ListedRow>(
  rows: readonly R[],
  { tab, term, sort, locale }: { tab: Tab, term: string, sort: Sort, locale: string },
): R[] => {
  const needle = term.trim().toLocaleLowerCase(locale)
  const collator = new Intl.Collator(locale)
  const byTitle = (a: ListedRow, b: ListedRow) => {
    const [left, right] = [a.summary.title, b.summary.title]
    return !left || !right ? Number(!left) - Number(!right) : collator.compare(left, right)
  }
  return rows
    .filter(row => (tab === 'ALL' || tabOf(row.summary.status) === tab) && (row.summary.title ?? '').toLocaleLowerCase(locale).includes(needle))
    .sort((a, b) => {
      if (sort === 'title') return byTitle(a, b)
      const [left, right] = [numberOf(a, sort), numberOf(b, sort)]
      if (left === undefined || right === undefined) return Number(left === undefined) - Number(right === undefined) || byTitle(a, b)
      return right - left || byTitle(a, b)
    })
}

/** Whether a row offers its +: a Watching or Rewatching row with an episode left past `progress`. */
export const offersOneMore = (row: ListedRow, progress?: number) => {
  const current = rowOf(row, row.episodeCount)
  return tabOf(row.summary.status) === 'WATCHING' && (current.total == null || (progress ?? current.progress) < current.total)
}

/**
 * What a + writes, by tracker: one episode past `progress` (the row's own unless given), to every tracker
 * of the row the title row would write it to by the viewer's choices in `stored` (tracking/compact-prefs.ts),
 * held back from one that counts other episodes than the row.
 */
export const oneMore = (row: ListedRow, stored: Record<string, boolean>, progress?: number): Record<string, Fields> => {
  const current = rowOf(row, row.episodeCount)
  const change = { progress: (progress ?? current.progress) + 1 }
  const patches: Record<string, Fields> = {}
  for (const answer of row.answers) {
    const target = targetOf(answer, stored[answer.tracker.id])
    if (target.kind !== 'check' || !target.sendable) continue
    const patch = patchFor(answer, change, { ...current, ...change })
    if (patch) patches[answer.tracker.id] = patch
  }
  return patches
}
