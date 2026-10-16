// The trackers the worker serves, with the server each is built on replaced: what an answer names a
// tracker as when the tracker itself could not (it has not answered yet, or its server failed).
import { expect, test, vi } from 'vite-plus/test'

vi.mock('../../../src/worker/extractor', () => ({ makeExtractor: (extractor: unknown) => ({ extractor }) }))
vi.mock('../../../src/worker/site-sessions', () => ({ siteSession: () => ({}) }))

const { trackerOf, trackers } = await import('../../../src/worker/trackers')

test('names Crunchyroll as keeping Plan to watch alone, on 5 stars, and every other tracker as keeping every status', () => {
  const named = Object.fromEntries(trackers.map(entry => [entry.extractor.origin, trackerOf(entry)]))
  expect(Object.keys(named).sort()).toEqual(['anilist', 'cr', 'mal', 'stub'])
  expect(named.cr).toMatchObject({ id: 'cr', name: 'Crunchyroll', canWrite: false, statuses: ['PLANNING'], scoreScale: 'POINT_5' })
  for (const id of ['anilist', 'mal', 'stub']) expect(named[id]!.statuses, id).toBeNull()
})
