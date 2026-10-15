import type { TheaterCandidate } from './theater'

import { useEffect, useState } from 'preact/hooks'
import { isSameShow, standsInFor, theaterKey } from './theater'

const probeResults = new Map<string, Promise<boolean>>()
const loaded = new Set<string>()
const FAILED_PROBE_TTL_MS = 30_000

const probe = (url: string) => {
  const existing = probeResults.get(url)
  if (existing) return existing
  const result = new Promise<boolean>(resolve => {
    const image = new Image()
    image.onload = () => {
      loaded.add(url)
      resolve(true)
    }
    image.onerror = () => {
      setTimeout(() => probeResults.delete(url), FAILED_PROBE_TTL_MS)
      resolve(false)
    }
    image.src = url
  })
  probeResults.set(url, result)
  return result
}

/** The media a cover is drawn for. */
export type CoverOwner = Pick<TheaterCandidate, '_id' | 'uri' | 'handles'>

/**
 * The url of the first of `covers` that loads, for `owner`.
 *
 * The cover drawn stays while each new owner continues from the one it was drawn for, until a cover
 * of the new owner has loaded, so a later answer with no covers, or only broken ones, never blanks it.
 * An owner continues from the same show (`isSameShow`), and with `standIn` also from the show it is a
 * season drawn in the place of (`standsInFor`), which only a listing's card is. Any other owner
 * starts from the first of its own covers already known to load, else its first cover.
 */
export const useCoverUrl = (
  covers: ({ url: string } | null | undefined)[] | null | undefined,
  owner: CoverOwner | null | undefined,
  { standIn = false } = {}
) => {
  const urls = (covers ?? []).map(cover => cover?.url).filter((url): url is string => Boolean(url))
  const key = urls.join('|')
  const [drawn, setDrawn] = useState<{ owner: typeof owner, url?: string }>({ owner })
  const continues = (held: typeof owner) => !!owner && !!held && (isSameShow(owner, held) || (standIn && standsInFor(owner, held)))

  useEffect(() => {
    let cancelled = false
    setDrawn(drawn => continues(drawn.owner) ? drawn : { owner })
    ;(async () => {
      for (const candidate of urls) {
        const loaded = await probe(candidate)
        if (cancelled) return
        if (loaded) {
          setDrawn({ owner, url: candidate })
          return
        }
      }
    })()
    return () => { cancelled = true }
  }, [key, owner && theaterKey(owner)])

  return (continues(drawn.owner) ? drawn.url : undefined) ?? urls.find(url => loaded.has(url)) ?? urls[0]
}
