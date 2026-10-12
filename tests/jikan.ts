import { use, expect } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiShallowDeepEqual from 'chai-shallow-deep-equal'

use(chaiAsPromised)
use(chaiShallowDeepEqual)

const card = (id: number, title: string) =>
  `<div class="js-anime-category-producer js-anime-type-1"><a href="https://myanimelist.net/anime/${id}/x" class="link-title">${title}</a></div>`

const ctxAnswering = (body: string, ok = true) => ({
  fetch: async () => ({ ok, status: ok ? 200 : 429, text: async () => body })
}) as any

const drain = async (generator: AsyncGenerator<any>) => {
  const yielded: any[] = []
  for await (const value of generator) yielded.push(value)
  return yielded
}

const captureErrors = async <T>(run: () => Promise<T>): Promise<[T, string]> => {
  const original = console.error
  const lines: string[] = []
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  try {
    return [await run(), lines.join('\n')]
  } finally {
    console.error = original
  }
}

const mediaPage = async (input: Record<string, unknown>, ctx: any) => {
  const { resolvers } = await import('../src/sources/jikan/extractor')
  return drain((resolvers as any).Subscription.mediaPage.subscribe(undefined, { input }, ctx))
}

export const seasonPageYieldsItsNewShows = async () => {
  const body = `<div class="anime-header">TV (New)</div>${card(1, 'A')}${card(2, 'B')}<div class="anime-header">TV (Continuing)</div>${card(3, 'C')}`
  const [yielded] = await captureErrors(() => mediaPage({ status: 'RELEASING' }, ctxAnswering(body)))
  expect(yielded[0].mediaPage.nodes.map((node: any) => node.uri)).to.deep.equal(['mal:1', 'mal:2'])
}

export const refusedSeasonPageDegradesToEmpty = async () => {
  const [yielded, errors] = await captureErrors(() => mediaPage({ status: 'RELEASING' }, ctxAnswering('<html><body>Too many requests</body></html>', false)))
  expect(yielded[0].mediaPage.nodes).to.deep.equal([])
  expect(errors).to.contain('MyAnimeList')
}

export const failedSeasonFetchDegradesToEmpty = async () => {
  const ctx = { fetch: async () => { throw new TypeError('Failed to fetch') } } as any
  const [yielded, errors] = await captureErrors(() => mediaPage({ status: 'RELEASING' }, ctx))
  expect(yielded[0].mediaPage.nodes).to.deep.equal([])
  expect(errors).to.contain('MyAnimeList')
}
