// SauceNAO scene search via an attached hidden browser frame (`https://saucenao.com/`).
// Attaches lazily only when the viewer searches with a picture, sends same-origin `POST /search.php`
// using the real browser session (no API key), and never waits out or solves anti-bot challenges.

import type { SauceNaoPageApi } from './saucenao-page'
import type { SauceNaoAnswer } from './saucenao-parse'
import type { Site } from '../site'
import type { SessionFrames } from '../tracking/session-frames'

import { attachFrame } from '@fkn/lib'
import { expose } from 'osra'

import { createSessionFrames } from '../tracking/session-frames'
import { attachCookies, detectBackend } from '../utils/fkn-backend'
import { mountHiddenFrame } from '../utils/hidden-frame'
import { parseSauceNaoHtml } from './saucenao-parse'

export const SAUCENAO_ORIGIN = 'https://saucenao.com'
export const SAUCENAO_DOMAINS = ['saucenao.com']
const SAUCENAO_REASON = 'Search for a scene on saucenao.com using the picture you chose'
const MAX_WIDTH = 640

/** SauceNAO database indices queried per Stub site (21 = Anime, 23 = Movies, 24 = Shows). */
export const SAUCENAO_DBS: Readonly<Record<Site, number[]>> = {
  anime: [21],
  movie: [23],
  series: [24],
  stub: [21, 23, 24],
}

export type PreparedPicture = { bytes: Uint8Array, mimeType: string }

/** Downscales large screenshots to a compact JPEG when the browser supports OffscreenCanvas. */
export const preparePictureBytes = async (picture: Blob): Promise<PreparedPicture> => {
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(picture)
      try {
        const scale = Math.min(1, MAX_WIDTH / bitmap.width)
        const width = Math.max(1, Math.round(bitmap.width * scale))
        const height = Math.max(1, Math.round(bitmap.height * scale))
        const canvas = new OffscreenCanvas(width, height)
        const context = canvas.getContext('2d')
        if (context) {
          context.drawImage(bitmap, 0, 0, width, height)
          const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
          return { bytes: new Uint8Array(await jpeg.arrayBuffer()), mimeType: 'image/jpeg' }
        }
      } finally {
        bitmap.close()
      }
    } catch {
      // Unreadable or non-image mock blobs fall back to raw bytes below.
    }
  }
  return { bytes: new Uint8Array(await picture.arrayBuffer()), mimeType: picture.type || 'image/jpeg' }
}

/** Builds a serialized SauceNAO client over a `SessionFrames` instance for unit testing or runtime use. */
export const createSauceNaoClient = ({ frames, prepare = preparePictureBytes }: {
  frames: Pick<SessionFrames<SauceNaoPageApi>, 'use'>
  prepare?: (picture: Blob) => Promise<PreparedPicture>
}) => {
  let queue: Promise<unknown> = Promise.resolve()

  const run = async (picture: Blob, site: Site): Promise<SauceNaoAnswer> => {
    try {
      const { bytes, mimeType } = await prepare(picture)
      const dbs = SAUCENAO_DBS[site]
      const { status, html } = await frames.use('saucenao', api => api.search({ bytes, mimeType, dbs }))
      const parsed = parseSauceNaoHtml(html)
      if ('error' in parsed) return parsed
      if (status === 429 || status === 403) return { error: 'busy' }
      if (status >= 400) return { error: 'failed' }
      return parsed
    } catch {
      return { error: 'busy' }
    }
  }

  return (picture: Blob, site: Site): Promise<SauceNaoAnswer> => {
    const answer = queue.then(() => run(picture, site))
    queue = answer
    return answer
  }
}

let defaultSearchPromise: Promise<(picture: Blob, site: Site) => Promise<SauceNaoAnswer>> | undefined

const getDefaultSearch = () => {
  defaultSearchPromise ??= import('./saucenao-page.ts?page-script').then(({ default: pageScript }) => {
    // Wait until the first scene search to build and mount the frame controller, and let attach load the
    // real `https://saucenao.com/` document rather than a blank placeholder so same-origin POSTs carry real cookies.
    const frames = createSessionFrames<SauceNaoPageApi>(
      [{
        id: 'saucenao',
        url: `${SAUCENAO_ORIGIN}/`,
        origin: SAUCENAO_ORIGIN,
        domains: SAUCENAO_DOMAINS,
        reason: SAUCENAO_REASON,
        pageScript,
      }],
      {
        attach: async ({ url: _url, ...options }) => {
          const backend = await detectBackend()
          return attachFrame({ ...options, cookies: attachCookies(backend) })
        },
        mount: () => mountHiddenFrame('SauceNAO'),
        connect: port => expose<SauceNaoPageApi>({}, { transport: port }),
        appOrigin: location.origin,
        key: () => crypto.randomUUID(),
        connectTimeoutMs: 12_000,
        callTimeoutMs: 20_000,
      },
    )
    return createSauceNaoClient({ frames })
  })
  return defaultSearchPromise
}

/** Searches SauceNAO anonymously inside a real browser hidden frame; never rejects. */
export const searchSauceNao = async (picture: Blob, site: Site): Promise<SauceNaoAnswer> => {
  try {
    const run = await getDefaultSearch()
    return await run(picture, site)
  } catch {
    return { error: 'busy' }
  }
}
