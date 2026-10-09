// The one thing this page DOES rather than reads: it asks the sources about the uri it was handed.
//
// WHY A DEBUG PAGE ASKS ANYTHING AT ALL. The graph engine is in memory for the life of the worker
// that opened it, and a full page load makes a new worker with an empty graph. So a trace url pasted
// into a bug report always arrives cold: it answered `graph-empty` for every uri, every time, and the
// `not-enabled` message told the reader to reload with the flag, which produced exactly that empty
// graph. The two states formed a loop that no pasted link could escape (measured 2026-09-13), while
// the page's own intro promised "it rides in the url, so this page can be linked into a bug report".
//
// So the page warms what it was asked about, the same way the media view warms it: one `media(uri)`
// subscription, which is what makes the worker fan out to the sources, which is what the ingest tee
// writes into the graph, which is what a pass then clusters. Then it traces again.
//
// ITS OWN DOCUMENT, NOT THE MODAL'S. `src/router/home/media-modal.tsx` cannot be imported outside a
// browser build at all (it reaches urql, whose CommonJS `require('react')` no alias intercepts, so a
// test importing it dies on a missing module: `tests/unit/router/modal-media.test.ts` records the
// measurement). Reaching for its document would drag that whole module in. This one is
// narrower on purpose and asks for exactly the fields whose resolvers fan out: the handles, so every
// origin claiming this work is asked, and the episodes, so their lists arrive too. Nothing here is
// rendered, so a field that exists only for drawing is a request nobody reads.

import type { GraphQLRequest } from '../../utils/graphql-stream'

import { streamGraphQL } from '../../utils/graphql-stream'

/** The subscription the warm drives. Exported so a test can assert what it asks for. */
export const WARM_DOCUMENT = `
  subscription TraceWarm($input: MediaInput!) {
    media(input: $input) {
      _id
      uri
      origin
      id
      url
      episodeCount
      startDate
      status
      titles {
        language
        title
        score
      }
      handles {
        relation
        node {
          _id
          uri
          origin
          id
          url
        }
      }
      episodes {
        uri
        origin
        episodeNumber
        releaseDate
      }
    }
  }
`

/** How far the warm has got: what a reader watches while the sources are still answering. */
export type WarmProgress = {
  /** Payloads the subscription has yielded. Each one is the store having moved. */
  payloads: number
  /** The address the store has grown to, which widens as sources are folded in. Null until the first. */
  uri: string | null
  /** Handles and episodes on the newest payload: the two numbers that say the fan-out is working. */
  handles: number
  episodes: number
}

type WarmPayload = {
  data?: { media?: { uri?: unknown, handles?: unknown[], episodes?: unknown[] } | null }
}

const progressOf = (payload: unknown, count: number): WarmProgress => {
  const media = (payload as WarmPayload | null)?.data?.media
  return {
    payloads: count,
    uri: typeof media?.uri === 'string' ? media.uri : null,
    handles: Array.isArray(media?.handles) ? media.handles.length : 0,
    episodes: Array.isArray(media?.episodes) ? media.episodes.length : 0,
  }
}

/**
 * Ask the sources about one uri, reporting progress, and settle when they stop answering.
 *
 * Never rejects for the reason the page cares about: a build whose worker exposes no `handleRequest`,
 * or a worker that refuses the document, is a warm that did not happen, and the page says so beside a
 * trace that is still honest about being empty. It resolves with whatever progress it reached.
 *
 * The document goes through `handleRequest`, which is the function urql's own fetch exchange calls
 * (`src/urql.ts`), so this is the app's read path and not a second one. The worker import is dynamic
 * because `src/worker.ts` spawns a Worker and awaits an osra handshake at module scope.
 */
export const warmTrace = async (
  uri: string,
  { onProgress, settleMs = 25_000 }: {
    onProgress?: (progress: WarmProgress) => void
    settleMs?: number
  } = {},
): Promise<WarmProgress> => {
  let progress: WarmProgress = { payloads: 0, uri: null, handles: 0, episodes: 0 }
  if (!uri) return progress
  try {
    const worker = await import('../../worker') as unknown as { handleRequest?: GraphQLRequest }
    if (typeof worker.handleRequest !== 'function') return progress
    await streamGraphQL(worker.handleRequest, WARM_DOCUMENT, { input: { uri } }, {
      settleMs,
      onPayload: (payload, count) => {
        progress = progressOf(payload, count)
        onProgress?.(progress)
      },
    })
  } catch (error) {
    console.error(new Error('graph trace: the warm could not ask the sources', { cause: error }))
  }
  return progress
}
