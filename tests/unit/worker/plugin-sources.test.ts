import { describe, expect, test, vi } from 'vite-plus/test'

import { ACCOUNT_WAIT_MS, askAccount, readPluginPayload, readPluginSources } from '../../../src/worker/plugin-sources'

const source = (origin: string, name?: string) => ({
  origin,
  originUrl: `https://${origin}.test`,
  name,
  isApiOnly: false,
  resolvers: { Subscription: {} },
})

const origins = (result: ReturnType<typeof readPluginSources>) =>
  result.sources.map(entry => entry.meta.origin)

describe('readPluginSources', () => {
  test('the single-source shape still works, which is what every existing plugin sends', () => {
    const result = readPluginSources(source('solo', 'Solo'), 'https:x/solo')
    expect(origins(result)).toEqual(['solo'])
    expect(result.sources[0]!.meta.name).toBe('Solo')
    expect(result.rejected).toEqual([])
  })

  test('one package can declare a family of sources, each keeping its own name', () => {
    const result = readPluginSources(
      { sources: [source('animetosho', 'AnimeTosho'), source('nyaa', 'Nyaa')] },
      'https:x/indexers'
    )
    expect(origins(result)).toEqual(['animetosho', 'nyaa'])
    expect(result.sources.map(entry => entry.meta.name)).toEqual(['AnimeTosho', 'Nyaa'])
  })

  test('a malformed source costs ONLY itself; its siblings still register', () => {
    const result = readPluginSources(
      { sources: [source('good', 'Good'), source('BAD ORIGIN', 'Bad'), source('alsogood', 'Also')] },
      'https:x/mixed'
    )
    expect(origins(result)).toEqual(['good', 'alsogood'])
    expect(result.rejected).toEqual([{ origin: 'BAD ORIGIN', reason: 'origin must be a short lowercase token' }])
  })

  test('a source with no origin at all is named in the rejection rather than lost', () => {
    const result = readPluginSources({ sources: [source('ok'), { name: 'nameless' }] }, 'https:x/n')
    expect(origins(result)).toEqual(['ok'])
    expect(result.rejected[0]!.origin).toBe('(none)')
  })

  test('a repeated origin keeps the first and rejects only the repeat', () => {
    const result = readPluginSources(
      { sources: [source('dup', 'First'), source('dup', 'Second'), source('other', 'Other')] },
      'https:x/dup'
    )
    expect(origins(result)).toEqual(['dup', 'other'])
    expect(result.sources[0]!.meta.name).toBe('First')
    expect(result.rejected[0]).toMatchObject({ origin: 'dup' })
    expect(result.rejected[0]!.reason).toContain('twice')
  })

  test('every source being bad yields nothing, which the caller turns into a failed connection', () => {
    const result = readPluginSources({ sources: [source('BAD'), source('ALSO BAD')] }, 'https:x/all')
    expect(result.sources).toEqual([])
    expect(result.rejected.length).toBe(2)
  })

  test('an empty sources list falls back to the payload itself rather than registering nothing', () => {
    const result = readPluginSources({ ...source('solo'), sources: [] }, 'https:x/solo')
    expect(origins(result)).toEqual(['solo'])
  })

  test('the resolvers of each source are carried through, not merged', () => {
    const a = source('a1')
    const b = source('b1')
    const result = readPluginSources({ sources: [a, b] }, 'https:x/fam')
    expect(result.sources[0]!.source).toBe(a)
    expect(result.sources[1]!.source).toBe(b)
  })

  test('name defaults to the origin, and is capped so a long one cannot blow up the UI', () => {
    expect(readPluginSources(source('bare'), 'u').sources[0]!.meta.name).toBe('bare')
    const long = readPluginSources({ ...source('x'), name: 'n'.repeat(200) }, 'u')
    expect(long.sources[0]!.meta.name.length).toBe(64)
  })

  test('access is read as declared, and as none when left out, as every older plugin does, or of any other value', () => {
    const access = (value?: unknown) => readPluginSources({ ...source('s'), ...value === undefined ? {} : { access: value } }, 'u').sources[0]!.meta.access
    expect(access('account')).toBe('account')
    expect(access('paid')).toBe('paid')
    expect(access('none')).toBe('none')
    expect(access()).toBe('none')
    for (const value of ['Paid', 'free', true, 1, null, {}]) expect(access(value), JSON.stringify(value)).toBe('none')
  })
})

describe('askAccount', () => {
  test('passes the three answers through', async () => {
    for (const state of ['signed-in', 'signed-out', 'no-plan']) expect(await askAccount(async () => state)).toBe(state)
  })

  test('reads any other value, a rejection and a throw as no answer', async () => {
    for (const value of ['signed in', 'SIGNED-IN', true, undefined, null, { state: 'signed-in' }]) {
      expect(await askAccount(async () => value), JSON.stringify(value)).toBeUndefined()
    }
    expect(await askAccount(() => Promise.reject(new Error('the frame went away')))).toBeUndefined()
    expect(await askAccount(() => { throw new Error('not a promise') })).toBeUndefined()
  })

  test('an answer that never comes is no answer once ACCOUNT_WAIT_MS is out, and not before', async () => {
    vi.useFakeTimers()
    try {
      let settled: unknown = 'waiting'
      void askAccount(() => new Promise(() => {})).then(state => { settled = state })
      await vi.advanceTimersByTimeAsync(ACCOUNT_WAIT_MS - 1)
      expect(settled).toBe('waiting')
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

// `stub-source@1` plugins were written against `handles: [Media!]!`, a bare list of the rows a media
// is the same as, and every one of them still sends it: the nyaa package restates the cluster's
// handles as bare rows. The schema made a handle an edge, `{ node, relation }`, on 2026-09-04 and the
// worker read `handle.node` from then on, so a plugin row's handles were edges with no node.
describe('readPluginPayload', () => {
  const row = (uri: string, extra: Record<string, unknown> = {}) => ({
    uri, origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1), handles: [], episodes: [], ...extra,
  })

  test('a bare row in handles reads as the SAME_AS edge it always meant', () => {
    const out = readPluginPayload('media', { media: row('nyaa:1', { handles: [row('anilist:2'), row('mal:3')] }) })
    expect(out.media.handles.map((h: any) => [h.relation, h.node.uri])).toEqual([['SAME_AS', 'anilist:2'], ['SAME_AS', 'mal:3']])
  })

  test('an edge passes through untouched, and a bare row inside its node is converted too', () => {
    const inner = row('anilist:2', { handles: [row('kitsu:4')] })
    const out = readPluginPayload('media', { media: row('nyaa:1', { handles: [{ node: inner, relation: 'PART_OF' }] }) })
    expect(out.media.handles[0].relation).toBe('PART_OF')
    expect(out.media.handles[0].node.handles).toEqual([{ node: expect.objectContaining({ uri: 'kitsu:4' }), relation: 'SAME_AS' }])
  })

  test('a row with only origin and id gains its uri, and anything that is neither row nor edge is dropped', () => {
    const out = readPluginPayload('media', { media: row('nyaa:1', { handles: [{ origin: 'anilist', id: '2' }, null, 'junk', { relation: 'SAME_AS' }] }) })
    expect(out.media.handles).toEqual([{ node: expect.objectContaining({ uri: 'anilist:2', origin: 'anilist', id: '2' }), relation: 'SAME_AS' }])
  })

  test('episode handles and every mediaPage node are read the same way, and a null media passes through', () => {
    const page = readPluginPayload('mediaPage', { mediaPage: { nodes: [row('nyaa:1', { handles: [row('anilist:2')] }), row('nyaa:5')] } })
    expect(page.mediaPage.nodes[0].handles[0]).toEqual({ node: expect.objectContaining({ uri: 'anilist:2' }), relation: 'SAME_AS' })
    expect(page.mediaPage.nodes[1].handles).toEqual([])
    const media = readPluginPayload('similarMedia', { similarMedia: row('nyaa:1', { episodes: [{ uri: 'nyaa:1-1', origin: 'nyaa', id: '1-1', mediaUri: 'nyaa:1', handles: [{ uri: 'anilist:2-1', origin: 'anilist', id: '2-1' }] }] }) })
    expect(media.similarMedia.episodes[0].handles).toEqual([{ node: expect.objectContaining({ uri: 'anilist:2-1' }), relation: 'SAME_AS' }])
    expect(readPluginPayload('media', { media: null })).toEqual({ media: null })
  })
})
