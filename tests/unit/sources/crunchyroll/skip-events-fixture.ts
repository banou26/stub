// Crunchyroll skip-events files, in the shape measured 2026-09-26 on
// https://static.crunchyroll.com/skip-events/production/<episodeId>.json. Only G8WUND5JX's credits
// times are real; the ids are placeholders, and the other times follow the same shape, since the
// sampled episodes carried credits alone.

const entry = (type: string, start: number, end: number) => ({
  approverId: 'placeholder-approver',
  distributionNumber: '1',
  end,
  seriesId: 'GSERIES00',
  start,
  title: 'An Episode',
  type,
})

/** G8WUND5JX as served: credits only, the other three written as empty objects. */
export const CREDITS_ONLY = {
  credits: entry('credits', 1680, 1767),
  intro: {},
  lastUpdated: '2026-09-26T00:00:00.000Z',
  mediaId: 'GMEDIA000',
  preview: {},
  recap: {},
}

/** GQJUMNE75's shape: the keys it has nothing for are missing rather than empty. */
export const CREDITS_KEY_ONLY = {
  credits: entry('credits', 1325, 1415),
  lastUpdated: '2026-09-26T00:00:00.000Z',
  mediaId: 'GMEDIA001',
}

/** Every event, out of order as a JSON object may carry them. */
export const EVERY_EVENT = {
  preview: entry('preview', 1410, 1440),
  credits: entry('credits', 1320, 1410),
  intro: entry('intro', 60, 150),
  recap: entry('recap', 0, 45),
  lastUpdated: '2026-09-26T00:00:00.000Z',
  mediaId: 'GMEDIA002',
}

/** An episode Crunchyroll has marked nothing on. */
export const NO_EVENTS = {
  credits: {},
  intro: {},
  lastUpdated: '2026-09-26T00:00:00.000Z',
  mediaId: 'GMEDIA003',
  preview: {},
  recap: {},
}

/** An opening after a 60 s cold open, and nothing else. */
export const OPENING_ONLY = { intro: entry('intro', 60, 150) }
