// The episodes either side of the one playing, and the source each opens on. Imports only
// ./auto-pick, so it is tested without the watch page, which reaches the worker.

import { bestSource, type Ways } from './auto-pick'

/** The row before `index`, and the row after it once it is out. Rows are in episode order, so a gap in the numbering is stepped over. */
export const neighbours = <T>(rows: readonly T[], index: number, unreleased: readonly boolean[]) => ({
  previous: index > 0 ? rows[index - 1] : undefined,
  next: index >= 0 && !unreleased[index + 1] ? rows[index + 1] : undefined,
})

/**
 * The source another episode opens on: its best handle `origin` plays, so a viewer stays on the
 * site or the release they chose. Undefined when that origin has none, and the address then names
 * no source, so the Play pick decides there.
 */
export const sourceFor = (handles: Parameters<typeof bestSource>[0], origin: string | undefined, ways: Ways) =>
  origin ? bestSource(handles.filter(handle => handle.origin === origin), ways)?.uri : undefined
