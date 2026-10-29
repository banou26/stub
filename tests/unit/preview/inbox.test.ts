import type { AnswerRow } from '../../../src/worker/graph'
import type { InboxLine, Run } from '../../../src/preview/inbox'

import { gunzipSync } from 'node:zlib'

import { expect, test } from 'vite-plus/test'

import { inboxLines, inboxObject } from '../../../src/preview/inbox'

const row = (seq: number, origin: string, id: string, operation: string, raw: object, kind: AnswerRow['kind'] = 'media'): AnswerRow => ({
  key: `sha-${seq}`, seq, uri: `${origin}:${id}`, origin, kind, operation, selection: Object.keys(raw).sort(), raw: JSON.stringify(raw),
})

// a settled Frieren run: two catalogues' own answers, Netflix's show it is part of, JustWatch's, a later search hit
// and a fuller second answer of Kitsu's, beside rows that are not a source's media answer
const ROWS = [
  row(1, 'anilist', '154587', 'MEDIA', { id: '154587', titles: [{ title: 'Frieren: Beyond Journey\'s End' }] }),
  row(2, 'kitsu', '46474', 'MEDIA', { id: '46474', titles: [] }),
  row(3, 'nf', '81726714', 'MEDIA', { id: '81726714', scope: 'CONTAINER' }),
  row(4, 'jw', '364792-373583', 'MEDIA', { id: '364792-373583' }),
  row(5, 'kitsu', '46474', 'UNKNOWN', { id: '46474' }),
  row(6, 'kitsu', '49240', 'MEDIA_PAGE', { id: '49240' }),
  row(7, 'kitsu', '46474', 'MEDIA', { id: '46474', titles: [{ title: 'Sousou no Frieren' }] }),
  row(8, 'kitsu', '46474-1', 'MEDIA', { uri: 'kitsu:46474-1' }, 'episode'),
  row(9, 'cr', 'cr', 'UNKNOWN', { id: 'cr' }, 'origin'),
  row(10, 'offline', 'mal-52991', 'MEDIA', { id: 'mal-52991' }),
]

const RUN: Run = {
  run: 'ag:(anilist:154587,kitsu:46474,mal:52991)',
  handles: [
    { relation: 'SAME_AS', node: { uri: 'anilist:154587' } },
    { relation: 'SAME_AS', node: { uri: 'kitsu:46474' } },
    { relation: 'SAME_AS', node: { uri: 'jw:364792-373583' } },
    { relation: 'PART_OF', node: { uri: 'nf:81726714' } },
    { relation: 'INCLUDES', node: { uri: 'kitsu:46474' } },
  ],
  settled: true,
  fetchedAt: '2026-10-26T14:05:31.000Z',
  writer: { by: 'stub-preview', stub: '0.0.62', commit: 'bdd2430e' },
  regionOf: origin => origin === 'jw' ? 'US' : null,
}

const keyOf = ({ index }: InboxLine) => [index.source, index.id, index.region, index.class].join(' ')

test('every source\'s media answer gets its index line and its body, the newest of each source, id, region and class', () => {
  const lines = inboxLines(ROWS, RUN)
  expect(lines.map(keyOf)).toEqual([
    'anilist 154587  full',
    'kitsu 46474  full',
    'nf 81726714  full',
    'jw 364792-373583 US full',
    'kitsu 46474  list',
    'kitsu 49240  list',
  ])
  expect(lines[0]).toEqual({
    index: { source: 'anilist', id: '154587', region: null, class: 'full', sha256: 'sha-1', fetchedAt: RUN.fetchedAt, partial: false, role: 'member', body: true, writer: RUN.writer },
    body: { source: 'anilist', id: '154587', form: 'answer', sha256: 'sha-1', run: RUN.run, operation: 'MEDIA', selection: ['id', 'titles'], body: ROWS[0]!.raw },
  })
  expect(lines[1]!.body.body).toBe(ROWS[6]!.raw)
  expect(lines[1]!.index.sha256).toBe('sha-7')
})

test('a SAME_AS handle is a member, a PART_OF or INCLUDES one is related, and an answer the card does not hold has no role', () => {
  expect(Object.fromEntries(inboxLines(ROWS, RUN).map(line => [keyOf(line), line.index.role]))).toEqual({
    'anilist 154587  full': 'member',
    'kitsu 46474  full': 'member',
    'nf 81726714  full': 'related',
    'jw 364792-373583 US full': 'member',
    'kitsu 46474  list': 'member',
    'kitsu 49240  list': null,
  })
})

test('a run cut before it settled marks every line partial', () => {
  const lines = inboxLines(ROWS, { ...RUN, settled: false })
  expect(lines).toHaveLength(6)
  expect(lines.every(line => line.index.partial)).toBe(true)
})

test('the object is the lines as gzip JSON lines, keyed by the run\'s day and a random id', async () => {
  const lines = inboxLines(ROWS, RUN)
  const object = (await inboxObject(lines, RUN.fetchedAt))!
  expect(object.key).toMatch(/^inbox\/2026-10-26\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl\.gz$/)
  const text = gunzipSync(Buffer.from(object.body)).toString('utf8')
  expect(text.endsWith('\n')).toBe(true)
  expect(text.trimEnd().split('\n').map(line => JSON.parse(line))).toEqual(lines)
  expect((await inboxObject(lines, RUN.fetchedAt))!.key).not.toBe(object.key)
})

test('a run no source answered a media for writes no object', async () => {
  expect(inboxLines([ROWS[7]!, ROWS[8]!, ROWS[9]!], RUN)).toEqual([])
  expect(await inboxObject([], RUN.fetchedAt)).toBeUndefined()
})
