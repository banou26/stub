// A show only the offline history answers (HOR-915), asked under the catalogue ids a shared link carries, with every
// request refused: the title page's media subscription, through stub's own resolvers, graph and anime.fkn.app's site,
// as the link preview runs it (src/preview/index.ts). Before the fix it sent no payload at all.
import { createSchema, createYoga } from 'graphql-yoga'
import { afterAll, beforeAll, expect, test, vi } from 'vite-plus/test'

import { typeDefs } from '../../../src/generated/schema/typeDefs.generated'
import { resolvers } from '../../../src/worker/resolvers'
import { enableGraph, keepEpisodes, setReadStore, stopScheduler } from '../../../src/worker/graph'
import { closeGraph } from '../../../src/worker/graph/engine'
import { setSite } from '../../../src/site'

vi.mock('../../../src/worker/fetch', () => {
  const refuse = async (input: unknown) => { throw new TypeError(`refused ${String(input)}`) }
  return { fetch: refuse, fetchWithBackoff: refuse }
})

const MEDIA = 'subscription Media($input: MediaInput!) { media(input: $input) { uri categories titles { title } } }'

const yoga = createYoga({ schema: createSchema({ typeDefs, resolvers }), maskedErrors: false, logging: false, graphiql: false })

beforeAll(async () => {
  setSite('anime')
  keepEpisodes(false)
  await enableGraph(true, { scheduler: true })
  setReadStore('graph')
})
afterAll(async () => {
  stopScheduler()
  await closeGraph()
})

type Media = { uri: string, categories: string[], titles: { title: string }[] }

/** The subscription's first payload that carries a title, or nothing once it ends without one. */
const firstTitled = async (uri: string): Promise<Media | undefined> => {
  const controller = new AbortController()
  const response = await yoga.handleRequest(new Request('http://test/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ query: MEDIA, variables: { input: { uri } } }),
    signal: controller.signal,
  }), {})
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return undefined
      buffer += value
      let end: number
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const data = /^data: (.+)$/m.exec(buffer.slice(0, end))?.[1]
        buffer = buffer.slice(end + 2)
        const media = data ? JSON.parse(data)?.data?.media as Media | undefined : undefined
        if (media?.titles.length) return media
      }
    }
  } finally {
    controller.abort()
    void reader.cancel().catch(() => {})
  }
}

// Mutations: drop ANIME from `historyMedia`; drop the claims fallback in `createMediaReader.read`; drop the claimed
// placeholders from `viewOf`. Each leaves the subscription with no titled payload, and the test at its timeout.
test('Naruto, asked as mal:20, draws the history\'s record as an anime', async () => {
  const media = await firstTitled('ag:(mal:20)')
  expect(media?.titles[0]?.title).toBe('Naruto')
  expect(media?.uri).toBe('ag:(offline:mal-20)')
  expect(media?.categories).toEqual(['ANIME'])
}, 30_000)

test('and Fullmetal Alchemist: Brotherhood, asked as anilist:5114, the same', async () => {
  expect((await firstTitled('ag:(anilist:5114)'))?.titles[0]?.title).toBe('Fullmetal Alchemist: Brotherhood')
}, 30_000)
