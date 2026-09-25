/**
 * What the page answers: the BIF's bytes and which read found its url, or why there are none.
 *
 * - `no-player`: no `.video-player-wrapper` holding a `<video>` by the deadline (an unfocused tab
 *   never mounts Crunchyroll's player)
 * - `no-bif`: the player is there but carries no `.bif` url
 * - `fetch-failed`, `too-large`: the url was found and its file could not be brought back
 * - `failed`: anything else the page threw, in `detail`
 */
export type BifRead =
  | { bytes: ArrayBuffer, via: 'named' | 'search' }
  | { none: 'no-player' | 'no-bif' | 'fetch-failed' | 'too-large' | 'failed', detail?: string }

export type BifReadOptions = {
  /** How long to wait for the player and its BIF url, in ms. */
  waitMs: number
  /** How long the file's fetch may take, in ms. */
  fetchMs: number
  /** The largest file to carry back, in bytes: the extension relay refuses a result over 32 MiB. */
  maxBytes: number
}

/**
 * Runs INSIDE Crunchyroll's page, through `frame.evaluate`, and never in stub's own realm.
 *
 * evaluate sends this as source, so it captures nothing from this module: every helper lives in the
 * body and every setting arrives in `options`. It never throws: a page without the file answers
 * `{ none }` with the reason.
 *
 * The url is `_currentBifUrl` on the thumbnail orchestrator of the player that Crunchyroll's React
 * tree hands down as a context value (`volumeVM._player`), read off the fibers of
 * `.video-player-wrapper` and its descendants (measured 2026-09-26). Those are minified private
 * names, so when that path misses, a bounded breadth-first search of the same objects takes the
 * first string that is a `.bif` url.
 */
export const readCrunchyrollBif = async ({ waitMs, fetchMs, maxBytes }: BifReadOptions): Promise<BifRead> => {
  const MAX_NODES = 3_000
  const MAX_ANCESTORS = 40
  const MAX_OBJECTS = 20_000
  const MAX_DEPTH = 8
  const MAX_KEYS = 500
  const BIF_URL = /^(?:https?:\/\/|\/)\S*\.bif(?:[?#]\S*)?$/i

  const isBifUrl = (value: unknown): value is string =>
    typeof value === 'string' && value.length < 8_192 && value.includes('.bif') && BIF_URL.test(value)

  const read = (object: unknown, key: string): unknown => {
    try {
      return (object as Record<string, unknown> | null | undefined)?.[key]
    } catch {
      return undefined
    }
  }

  const fiberOf = (node: Element) => {
    const key = Object.keys(node).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'))
    return key ? read(node, key) : undefined
  }

  // every context value provided at or above an element of the player: up from the wrapper nearest
  // first, then up from each descendant as far as the wrapper
  const contextValues = (wrapper: Element) => {
    const values: object[] = []
    const seen = new Set<unknown>()
    const nodes = [wrapper, ...Array.from(wrapper.querySelectorAll('*')).slice(0, MAX_NODES)]
    for (const node of nodes) {
      let fiber = fiberOf(node)
      for (let depth = 0; fiber && depth < MAX_ANCESTORS && !seen.has(fiber); depth += 1) {
        seen.add(fiber)
        const value = read(read(fiber, 'memoizedProps'), 'value')
        if (value && typeof value === 'object') values.push(value)
        fiber = read(fiber, 'return')
      }
    }
    return values
  }

  const search = (roots: object[]) => {
    const seen = new Set<unknown>()
    let level: unknown[] = roots
    let visited = 0
    for (let depth = 0; depth <= MAX_DEPTH && level.length; depth += 1) {
      const next: unknown[] = []
      for (const object of level) {
        if (seen.has(object)) continue
        seen.add(object)
        visited += 1
        if (visited > MAX_OBJECTS) return undefined
        let keys: string[]
        try {
          keys = Object.keys(object as object).slice(0, MAX_KEYS)
        } catch {
          continue
        }
        for (const key of keys) {
          const value = read(object, key)
          if (isBifUrl(value)) return value
          if (!value || typeof value !== 'object') continue
          // the page itself, its DOM and its binary buffers hold no url and are the bulk of the graph
          if (value === window || typeof read(value, 'nodeType') === 'number' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue
          next.push(value)
        }
      }
      level = next
    }
    return undefined
  }

  const find = (values: object[]): { url: string, via: 'named' | 'search' } | undefined => {
    const players: object[] = []
    for (const value of values) {
      const player = read(read(value, 'volumeVM'), '_player')
      if (!player || typeof player !== 'object') continue
      const url = read(read(read(player, 'playerOrchestrator'), 'thumbnailOrchestrator'), '_currentBifUrl')
      if (isBifUrl(url)) return { url, via: 'named' }
      players.push(player)
    }
    const url = search(players.length ? players : values)
    return url ? { url, via: 'search' } : undefined
  }

  const download = async (url: string, via: 'named' | 'search'): Promise<BifRead> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), fetchMs)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) return { none: 'fetch-failed', detail: `HTTP ${response.status}` }
      const declared = Number(response.headers.get('content-length'))
      if (declared > maxBytes) return { none: 'too-large', detail: `${declared} bytes` }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > maxBytes) return { none: 'too-large', detail: `${bytes.byteLength} bytes` }
      return { bytes, via }
    } catch (error) {
      return { none: 'fetch-failed', detail: String(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const deadline = Date.now() + waitMs
    let sawPlayer = false
    for (;;) {
      const wrapper = document.querySelector('.video-player-wrapper')
      if (wrapper?.querySelector('video')) {
        sawPlayer = true
        const found = find(contextValues(wrapper))
        if (found) return await download(found.url, found.via)
      }
      if (Date.now() >= deadline) return { none: sawPlayer ? 'no-bif' : 'no-player' }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  } catch (error) {
    return { none: 'failed', detail: String(error) }
  }
}
