// The link preview's entry, built by vite.preview.config.ts for functions/_middleware.ts: stub's offline data, and
// stub's own worker (the GraphQL server, the graph engine and every built-in source) answering one title's media
// subscription in a Pages Function, with src/preview/fetch.ts in place of the page's cloud.fetch.
import type { Site } from '../site'
import type { ExtractorDefinition } from '../worker/extractor'
import type { InboxObject } from './inbox'

import initFrizbee from 'frizbee'
import initSacha from 'sacha'

import { setSite, siteAsks } from '../site'
import { getMedia, origin as offline } from '../sources/offline/extractor'
import { asAggregatedUri } from '../utils/uri'
import { stop } from './fetch'
import { inboxLines, inboxObject } from './inbox'

export type Preview = { title: string, description?: string, image?: string, wide?: boolean, color?: string }

// what the title page draws of its subscription (src/router/title/index.tsx), asked with its own input
const PREVIEW_MEDIA = `
  subscription PreviewMedia($input: MediaInput!, $descriptionInput: MediaDescriptionInput!) {
    media(input: $input) {
      _id
      uri
      origin
      id
      url
      handles { relation node { _id uri origin id url } }
      titles { language title score }
      descriptions(input: $descriptionInput) { language description }
      covers { url color }
      banners { url }
      settled
    }
  }
`

// how long a stopped copy is given to unwind inside its request: One Piece's still held 90 MB after 100 ms, and after
// 300 ms only what a settled copy leaves (workerd on this machine, 2026-10-24, 1 run each)
const DRAIN_MS = 1_000

/** The two wasm modules stub's sources match titles and release names with, compiled: a Worker may not compile bytes. */
export type Wasm = { frizbee: WebAssembly.Module, sacha: WebAssembly.Module }

// Imported on the first answer rather than with this module, so a copy that only answers from the offline data
// (`offlineShow`) never builds them: a request building a copy took 183 ms with them and 2.4 ms without, a bare
// request 1.3 ms (workerd, medians of 64, 2026-10-26)
const start = async (wasm: Wasm) => {
  const [{ createSchema, createYoga }, { typeDefs }, { resolvers }, graph] = await Promise.all([
    import('graphql-yoga'),
    import('../generated/schema/typeDefs.generated'),
    import('../worker/resolvers'),
    import('../worker/graph'),
  ])
  await initFrizbee({ module_or_path: wasm.frizbee })
  await initSacha({ module_or_path: wasm.sacha })
  // a preview draws no episode, and a long series' episodes, in every source's answer, are most of what a copy holds:
  // One Piece's aborted under a 120 MiB V8 heap with them (2 of 2) and completed without (3 of 3; Detective Conan 3 of 3)
  // in workerd, 2026-10-24
  graph.keepEpisodes(false)
  await graph.enableGraph(true, { scheduler: true })
  graph.setReadStore('graph')
  return createYoga({ schema: createSchema({ typeDefs, resolvers }), maskedErrors: false, logging: false, graphiql: false })
}

let booting: ReturnType<typeof start> | undefined
const boot = (wasm: Wasm) => booting ??= start(wasm)

const plain = (html?: string, max = 200) => {
  const text = (html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text || undefined
}

type Media = {
  uri?: string
  handles?: { relation: string, node: { uri: string } }[]
  titles: { title: string }[]
  descriptions?: { description: string }[]
  covers: { url: string, color?: string | null }[]
  banners: { url: string }[]
  settled?: boolean | null
}

/** As the title page draws `media`: the first title, the longest description, the banner over the cover. */
export const previewOf = (media?: Media): Preview | undefined => {
  const title = media?.titles.at(0)?.title
  if (!media || !title) return undefined
  const description = media.descriptions?.map(({ description }) => description).sort((a, b) => b.length - a.length).at(0)
  const banner = media.banners.at(0)?.url
  const cover = media.covers.at(0)?.url
  return { title, description: plain(description), image: banner ?? cover, wide: Boolean(banner), color: media.covers.find(cover => cover.color)?.color ?? undefined }
}

/**
 * What stub's offline data alone says of `uri` on `site`, when it holds the show: the show's own `address`, and the
 * `preview` it draws when it holds a title and a cover. Reads only what the build bundled: it asks nothing of anyone,
 * and boots none of what `answer` does.
 *
 * `uri` may pick the show but only `address` may be run. Stub's asks read the old store, which unions everything an
 * address names, so a made-up address welds across shows: `ag:(jw:34435,mal:6)` claimed Cowboy Bebop's JustWatch and
 * Netflix seasons as Trigun's, and the inbox wrote them as its members (through the relays, 2026-10-31).
 */
export const offlineShow = async (uri: string, site: Site): Promise<{ address: string, preview?: Preview } | undefined> => {
  if (!siteAsks(offline, site)) return undefined
  const media = await getMedia(uri)
  return media ? { address: asAggregatedUri(media.uri), preview: media.covers.length ? previewOf(media) : undefined } : undefined
}

export type Answer = {
  /** The preview read when the sources settle or `deadline` passes, whichever is first. */
  first: Promise<Preview | undefined>
  /**
   * The preview read when the sources settle or `settleBy` passes, whichever is first, given once the copy has stopped
   * every source still asking and let them unwind. Until it settles the copy is still working.
   */
  last: Promise<Preview | undefined>
  /**
   * What the run's sources answered, as one object for the private source store's inbox (src/preview/inbox.ts), once
   * `last` has settled, or undefined when no source answered. Reads the run's answer log only when called.
   */
  inbox: () => Promise<InboxObject | undefined>
  /** Ends the copy now, as `settleBy` would; a copy still held back by `after` then never asks. */
  stop: () => void
}

/**
 * The preview stub draws for `uri` on `site`, from the title page's own subscription. Both promises exist when this
 * returns, so a caller can hand `last` to `waitUntil` before it waits on anything, and must: a copy whose request ends
 * before `last` keeps its sources' unfinished answers, and with them the whole copy, in the isolate's memory. `after`
 * holds the copy back until it settles, for a caller answering without it, since a boot takes the isolate's one thread:
 * a crawler's first byte came at 11 to 34 ms held back and 387 to 554 ms not (workerd, 3 runs each, 2026-10-31). The two
 * limits still count from this call. Once per copy of this module (`createPreview()` in vite.preview.config.ts).
 */
export const answer = (uri: string, site: Site, wasm: Wasm, { deadline, settleBy = 20_000, after }: { deadline: number, settleBy?: number, after?: Promise<unknown> }): Answer => {
  const controller = new AbortController()
  let media: Media | undefined
  let reader: ReadableStreamDefaultReader<string> | undefined
  let over = false
  const reading = (async () => {
    await after
    if (over) return
    setSite(site)
    const yoga = await boot(wasm)
    const response = await yoga.handleRequest(new Request('http://preview/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ query: PREVIEW_MEDIA, variables: { input: { uri, details: true }, descriptionInput: { type: 'HTML' } } }),
      signal: controller.signal,
    }), {})
    reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += value
      let end: number
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const data = /^data: (.+)$/m.exec(buffer.slice(0, end))?.[1]
        buffer = buffer.slice(end + 2)
        const next = data && JSON.parse(data)?.data?.media as Media | undefined
        if (!next) continue
        media = next
        if (next.settled) return
      }
    }
  })()
  // a timer rather than the abort alone: aborted, the request left its read waiting for the subscription's next
  // payload, which sources that have gone quiet never send (measured under vitest, 2026-10-23)
  let giveUp: ReturnType<typeof setTimeout> | undefined
  let end!: () => void
  let endedAt = ''
  // `over` is set at once, since a copy held back by `after` may resume before the abort below runs; `stop` only sets
  // it and settles a promise, as another request may call it
  const ended = Promise.race([reading.catch(() => {}), new Promise<void>(resolve => {
    end = () => {
      over = true
      resolve()
    }
    giveUp = setTimeout(end, settleBy)
  })])
    .then(() => {
      endedAt = new Date().toISOString()
      clearTimeout(giveUp)
      controller.abort()
      void reader?.cancel().catch(() => {})
      stop()
      return previewOf(media)
    })
  const last = ended.then(preview => new Promise<Preview | undefined>(resolve => setTimeout(resolve, DRAIN_MS, preview)))
  let late: ReturnType<typeof setTimeout> | undefined
  const first = Promise.race([ended, new Promise(resolve => { late = setTimeout(resolve, deadline) })])
    .then(() => previewOf(media))
    .finally(() => clearTimeout(late))
  const inbox = () => last.then(async () => {
    const [{ exportAnswers }, sources] = await Promise.all([import('../worker/graph'), import('../sources')])
    const regions = new Map(Object.values(sources).map(source => [source.origin, (source as Partial<ExtractorDefinition>).region]))
    const lines = inboxLines(await exportAnswers(), {
      run: media?.uri ?? uri,
      handles: media?.handles ?? [],
      settled: media?.settled === true,
      fetchedAt: endedAt,
      writer: { by: 'stub-preview', stub: __STUB_VERSION__, commit: __STUB_COMMIT__ },
      regionOf: origin => regions.get(origin)?.() ?? null,
    })
    return inboxObject(lines, endedAt)
  })
  return { first, last, inbox, stop: end }
}
