// Link previews' inbox objects, made by the preview's own writer (src/preview/inbox.ts) from answer rows, for the
// Offline history job's fold of them.
import type { AnswerRow } from '../../../../src/worker/graph'
import type { Run } from '../../../../src/preview/inbox'

import { createHash } from 'node:crypto'

import { inboxLines, inboxObject } from '../../../../src/preview/inbox'

/** A source's media answer as a run's answer log holds it, hashed over its body as the log's own key is. */
export const answer = (seq: number, origin: string, id: string, operation: string, raw: object): AnswerRow => ({
  key: createHash('sha256').update(`${origin}:${id}:${operation}:${JSON.stringify(raw)}`).digest('hex'),
  seq,
  uri: `${origin}:${id}`,
  origin,
  kind: 'media',
  operation,
  selection: Object.keys(raw).sort(),
  raw: JSON.stringify(raw),
})

export const FRIEREN_ANIZIP = {
  id: '17617',
  titles: [{ language: 'en', title: 'Frieren: Beyond Journey\'s End', score: 0.9 }, { language: 'ja', title: '葬送のフリーレン', score: 0.9 }],
  covers: [{ url: 'https://artworks.thetvdb.com/banners/v4/series/424536/posters/64cd29cb5bd4e.jpg', score: 0.9 }],
  banners: [{ url: 'https://artworks.thetvdb.com/banners/v4/series/424536/backgrounds/64cd2e5a2a6c1.jpg', score: 0.9 }],
}
export const FRIEREN_KITSU = {
  id: '46474',
  score: 0.3,
  titles: [{ language: 'en', title: 'Frieren: Beyond Journey\'s End', score: 0.3 }, { language: 'en', title: 'Sousou no Frieren', score: 0.3 }],
  descriptions: [{ language: 'en', description: 'The adventure is over but life goes on for an elf mage.', score: 0.3 }],
  covers: [{ url: 'https://media.kitsu.app/anime/46474/poster_image/original-9d2e.jpg', score: 0.3 }],
  banners: [{ url: 'https://media.kitsu.app/anime/cover_images/46474/original.jpg', score: 0.3 }],
  status: 'FINISHED',
}
export const FRIEREN_ANILIST = {
  id: '154587',
  titles: [{ language: 'en', title: 'Frieren: Beyond Journey\'s End', score: 0.9 }],
  descriptions: [{ language: 'en', description: 'AniList\'s own synopsis, which only the job\'s merge may read.', score: 0.9 }],
}

/**
 * A settled Frieren run: its catalogues' own answers, JustWatch's in the US, Netflix's show it is part of, and another
 * show's season hit.
 */
export const frierenRun = (fetchedAt: string, settled = true): { rows: AnswerRow[], run: Run } => ({
  rows: [
    answer(1, 'anilist', '154587', 'MEDIA', FRIEREN_ANILIST),
    answer(2, 'anizip', '17617', 'MEDIA', FRIEREN_ANIZIP),
    answer(3, 'kitsu', '46474', 'MEDIA', FRIEREN_KITSU),
    answer(4, 'nf', '81726714', 'MEDIA', { id: '81726714', scope: 'CONTAINER', titles: [{ language: 'en', title: 'Frieren', score: 0.6 }] }),
    answer(5, 'kitsu', '49240', 'MEDIA_PAGE', { id: '49240', score: 0.3, titles: [{ language: 'en', title: 'Dandadan', score: 0.3 }] }),
    answer(6, 'jw', '364792-373583', 'MEDIA', { id: '364792-373583', titles: [{ language: 'en', title: 'Frieren: Beyond Journey\'s End', score: 0.2 }] }),
  ],
  run: {
    run: 'ag:(anilist:154587,anizip:17617,kitsu:46474,mal:52991)',
    handles: [
      { relation: 'SAME_AS', node: { uri: 'anilist:154587' } },
      { relation: 'SAME_AS', node: { uri: 'anizip:17617' } },
      { relation: 'SAME_AS', node: { uri: 'kitsu:46474' } },
      { relation: 'SAME_AS', node: { uri: 'jw:364792-373583' } },
      { relation: 'PART_OF', node: { uri: 'nf:81726714' } },
    ],
    settled,
    fetchedAt,
    writer: { by: 'stub-preview', stub: '0.0.63', commit: '8ad2135c' },
    regionOf: origin => (origin === 'jw' ? 'US' : null),
  },
})

/** The inbox object a run with `rows` puts in the bucket, as its key and bytes. */
export const inboxEntry = async ({ rows, run }: { rows: AnswerRow[], run: Run }): Promise<[string, Buffer]> => {
  const object = (await inboxObject(inboxLines(rows, run), run.fetchedAt))!
  return [object.key, Buffer.from(object.body)]
}
