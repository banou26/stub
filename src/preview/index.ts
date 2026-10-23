// The link preview's entry, built by vite.preview.config.ts for functions/_middleware.ts: stub's own worker (the
// GraphQL server, the graph engine and every built-in source) answering one title's media subscription in a Pages
// Function, with src/preview/fetch.ts in place of the page's cloud.fetch.
import type { Site } from '../site'

import { createSchema, createYoga } from 'graphql-yoga'
import initFrizbee from 'frizbee'
import initSacha from 'sacha'

import { typeDefs } from '../generated/schema/typeDefs.generated'
import { resolvers } from '../worker/resolvers'
import { enableGraph, setReadStore } from '../worker/graph'
import { setSite } from '../site'

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

const yoga = createYoga({ schema: createSchema({ typeDefs, resolvers }), maskedErrors: false, logging: false, graphiql: false })

/** The two wasm modules stub's sources match titles and release names with, compiled: a Worker may not compile bytes. */
export type Wasm = { frizbee: WebAssembly.Module, sacha: WebAssembly.Module }

let booting: Promise<void> | undefined
const boot = (wasm: Wasm) => (booting ??= (async () => {
  await initFrizbee({ module_or_path: wasm.frizbee })
  await initSacha({ module_or_path: wasm.sacha })
  await enableGraph(true, { scheduler: true })
  setReadStore('graph')
})())

const plain = (html?: string, max = 200) => {
  const text = (html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text || undefined
}

type Media = {
  titles: { title: string }[]
  descriptions?: { description: string }[]
  covers: { url: string, color?: string | null }[]
  banners: { url: string }[]
  settled?: boolean
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

export type Answer = {
  /** The preview read when the sources settle or `deadline` passes, whichever is first. */
  first: Promise<Preview | undefined>
  /** The preview read when the sources settle or `settleBy` passes, whichever is first. */
  last: Promise<Preview | undefined>
}

/**
 * The preview stub draws for `uri` on `site`, from the title page's own subscription. Both promises exist when this
 * returns, so a caller can hand `last` to `waitUntil` before it waits on anything. Once per copy of this module
 * (`createPreview()` in vite.preview.config.ts).
 */
export const answer = (uri: string, site: Site, wasm: Wasm, { deadline, settleBy = 20_000 }: { deadline: number, settleBy?: number }): Answer => {
  const controller = new AbortController()
  let media: Media | undefined
  let reader: ReadableStreamDefaultReader<string> | undefined
  const reading = (async () => {
    setSite(site)
    await boot(wasm)
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
  const last = Promise.race([reading.catch(() => {}), new Promise(resolve => { giveUp = setTimeout(resolve, settleBy) })])
    .then(() => previewOf(media))
    .finally(() => {
      clearTimeout(giveUp)
      controller.abort()
      void reader?.cancel().catch(() => {})
    })
  let late: ReturnType<typeof setTimeout> | undefined
  const first = Promise.race([last, new Promise(resolve => { late = setTimeout(resolve, deadline) })])
    .then(() => previewOf(media))
    .finally(() => clearTimeout(late))
  return { first, last }
}
