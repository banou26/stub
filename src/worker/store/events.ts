// The graph's write events (4.5) share this bus so a later step can listen without a second one.
// They are INERT while the `?graph` flag is off, since neither the ingest that emits the first two
// nor the scheduler that listens to them and emits the third runs at all.
type StoreEventMap = {
  'media:changed': { uris?: string[] }
  'episode:changed': { uris?: string[] }
  'origin:changed': { ids?: string[] }
  /**
   * A new row, a new claim, a new HAS_EPISODE, or a projected column that moved. Wakes a pass.
   *
   * `uris` is `Media.uri`, `episodes` is `Episode.uri` (never a `HAS_EPISODE` key) and `claims` is
   * `CLAIMS.key`: the three the pass scopes its scans by. The two additions are optional because an
   * emitter that knows only what moved in `Media` still describes a legal wake, and a trigger naming
   * none of the three is a FULL pass.
   */
  'graph:changed': { seq: number, uris: string[], episodes?: string[], claims?: string[] }
  /** Unprojected `raw` fields only, or a re-asserted claim's node. Wakes a re-materialization. */
  'row:changed': { uris: string[] }
  /**
   * After a pass that applied something (6.6): the clusters whose membership, slots, attachments,
   * run length, anomalies or JSON moved, and every member uri of those clusters. The read path's
   * wake, so a reader is woken once the row it reads exists rather than at the commit before it.
   */
  'view:changed': { clusters: string[], uris: string[] }
}

const eventBus = new EventTarget()

export function emit<K extends keyof StoreEventMap>(
  type: K,
  detail: StoreEventMap[K]
): void {
  eventBus.dispatchEvent(new CustomEvent(type, { detail }))
}

/** Subscribe to one store event, returning the unsubscribe. Exported so a test can COUNT emissions:
 *  `media:changed` re-runs the fuzzy merge and every subscribed page, so an upsert that reports a
 *  change it did not make is not free. */
export function listen<K extends keyof StoreEventMap>(
  type: K,
  callback: (detail: StoreEventMap[K]) => void
): () => void {
  const handler = (e: Event) => callback((e as CustomEvent).detail)
  eventBus.addEventListener(type, handler)
  return () => eventBus.removeEventListener(type, handler)
}

type IteratorOptions = { abortSignal?: AbortSignal }

type Wakeable = { wake: () => void }

function makeAsyncIterator<T>(
  subscribe: (fire: () => void) => () => void,
  value: T,
  options?: IteratorOptions
): AsyncIterableIterator<T> & Wakeable {
  let resolve: ((result: IteratorResult<T>) => void) | null = null
  let pending = false

  const fire = () => {
    if (resolve) {
      resolve({ value, done: false })
      resolve = null
    } else {
      pending = true
    }
  }

  const cleanup = subscribe(fire)

  if (options?.abortSignal) {
    options.abortSignal.addEventListener('abort', () => {
      cleanup()
      if (resolve) resolve({ value: undefined as T, done: true })
    })
  }

  return {
    async next() {
      if (pending) {
        pending = false
        return { value, done: false as const }
      }
      return new Promise<IteratorResult<T>>(r => { resolve = r })
    },
    async return() {
      cleanup()
      return { value: undefined as T, done: true as const }
    },
    [Symbol.asyncIterator]() { return this },
    wake: fire,
  }
}

/** Each event of `type` with its detail, and a `wake` that yields `undefined` to this iterator alone. */
export function listenIterator<K extends keyof StoreEventMap>(
  type: K,
  options?: IteratorOptions
): AsyncIterableIterator<StoreEventMap[K] | undefined> & Wakeable {
  let resolve: ((result: IteratorResult<StoreEventMap[K] | undefined>) => void) | null = null
  const buffer: (StoreEventMap[K] | undefined)[] = []

  const push = (detail: StoreEventMap[K] | undefined) => {
    if (resolve) {
      resolve({ value: detail, done: false })
      resolve = null
    } else {
      buffer.push(detail)
    }
  }
  const unlisten = listen(type, push)

  if (options?.abortSignal) {
    options.abortSignal.addEventListener('abort', () => {
      unlisten()
      if (resolve) resolve({ value: undefined as any, done: true })
    })
  }

  return {
    async next() {
      if (buffer.length > 0) {
        return { value: buffer.shift(), done: false as const }
      }
      return new Promise<IteratorResult<StoreEventMap[K] | undefined>>(r => { resolve = r })
    },
    async return() {
      unlisten()
      return { value: undefined as any, done: true as const }
    },
    [Symbol.asyncIterator]() { return this },
    wake: () => push(undefined),
  }
}

/** One wake per event of `types`, and a `wake` that fires this iterator alone. */
export function listenMultipleIterator(
  types: (keyof StoreEventMap)[],
  options?: IteratorOptions
): AsyncIterableIterator<void> & Wakeable {
  return makeAsyncIterator(
    (fire) => {
      const unlisteners = types.map(type => listen(type, fire))
      return () => unlisteners.forEach(u => u())
    },
    undefined as void,
    options
  )
}

/** The events of `types`, debounced into one wake, and a `wake` that fires this iterator alone through the same debounce. */
export function debouncedListenIterator(
  types: (keyof StoreEventMap)[],
  debounceMs: number,
  options?: IteratorOptions
): AsyncIterableIterator<void> & Wakeable {
  let timeout: ReturnType<typeof setTimeout> | null = null
  let wake = () => {}

  const iterator = makeAsyncIterator(
    (fire) => {
      wake = () => {
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(fire, debounceMs)
      }
      const unlisteners = types.map(type => listen(type, wake))
      return () => {
        if (timeout) clearTimeout(timeout)
        unlisteners.forEach(u => u())
      }
    },
    undefined as void,
    options
  )
  return Object.assign(iterator, { wake: () => wake() })
}
