// The context a plugin source's resolver is handed (docs: request/plugins.md, "The context a plugin resolver
// receives"): the one function, and the viewer's languages the page last handed the worker.
import { expect, test, vi } from 'vite-plus/test'

// see tests/unit/worker/graph/read.test.ts: urql's CommonJS build cannot load here, and nothing below calls it
vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))

const { makeDelegatingResolvers } = await import('../../../src/worker/extractor')
const { holdViewerLanguages } = await import('../../../src/viewer-languages')

// one source, registered once, asked as many times as a test needs
const seen: { similarMedia: unknown, languages: unknown }[] = []
const resolvers = makeDelegatingResolvers('spec', {
  resolvers: {
    Subscription: {
      media: {
        subscribe: async (_parent: undefined, _args: unknown, ctx: unknown) => {
          seen.push(ctx as typeof seen[number])
          return (async function* () { yield { media: null } })()
        },
      },
    },
  },
}) as { Subscription: { media: { subscribe: (parent: unknown, args: unknown) => AsyncGenerator<unknown> } } }

const ask = async () => {
  for await (const _ of resolvers.Subscription.media.subscribe(undefined, { input: { uri: 'spec:1' } })) {}
  return seen.at(-1)!
}

test("a resolver gets the viewer's languages as tags, subtitles off as null, read at each call", async () => {
  holdViewerLanguages({ language: 'fr-FR', audio: 'ja', subtitles: null })
  const first = await ask()
  expect(first.languages).toEqual({ language: 'fr-FR', audio: 'ja', subtitles: null })
  expect(typeof first.similarMedia).toBe('function')
  expect(Object.keys(first).sort()).toEqual(['languages', 'similarMedia'])

  holdViewerLanguages({ language: 'fr-FR', subtitles: 'en' })
  expect((await ask()).languages).toEqual({ language: 'fr-FR', subtitles: 'en' })
})
