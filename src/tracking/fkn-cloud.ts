// FKN storage for the stub tracker, over the @fkn/lib calls it is handed. Import free, so a test hands
// it fakes of those calls; tracking/fkn-cloud-live.ts hands it the real ones. Runs on the main thread,
// where the broker is: the worker reaches it over osra (src/worker.ts).

import type { CloudAvailability, CloudEntry, CloudResult, TrackerCloud } from './account-link'

import { CLOUD_ROOT } from './account-link'

/** The slice of @fkn/lib this adapter calls. */
export type FknStorage = {
  /**
   * `@fkn/lib/api`'s `apiPromise`, for the two broker calls `@fkn/lib/cloud/fs` does not export. Not
   * `apiWithin`: its deadline latch is global to the page and flips 8 s after every call, even one that
   * was answered at once (lib/src/api.ts, 0.9.37), so the deadline is kept here instead.
   */
  api: () => Promise<{
    cloud: {
      fs: {
        availability?: () => Promise<CloudAvailability>
        list: () => Promise<{ path: string, updatedAt: string }[]>
      }
    }
  }>
  /** `@fkn/lib/cloud/fs`: `encryption`, and `promises.readFile` and `writeFile`. */
  encryption: () => Promise<{ unlocked: boolean }>
  readFile: (path: string, encoding: 'utf8') => Promise<string | Uint8Array>
  writeFile: (path: string, text: string) => Promise<void>
}

// the codes @fkn/lib/cloud/fs mints (`StorageLockedError`, `StorageNotFoundError`); a code does not
// survive osra, so they are read here and never thrown on to the worker
const LOCKED = 'FKN_E2E_LOCKED'
const NOT_FOUND = 'FKN_STORAGE_NOT_FOUND'

const refusal = (error: unknown): Exclude<CloudResult<never>, { ok: never }> => {
  const code = (error as { code?: string } | null)?.code
  if (code === LOCKED) return { locked: true }
  if (code === NOT_FOUND) return { missing: true }
  return { error: error instanceof Error ? error.message : String(error) }
}

/**
 * The tracker's view of FKN storage.
 *
 * Every call is bounded: `@fkn/lib` waits on the broker with no deadline of its own, and an answer
 * that never comes must read as "could not tell", never as a sign out. `availability` answers
 * `disconnected` only when the broker says so; a broker too old to say reads `unknown` on anything
 * but connected, so a failure can never clear the list.
 */
export const fknTrackerCloud = (lib: FknStorage, { timeoutMs = 8_000 }: { timeoutMs?: number } = {}): TrackerCloud => {
  const bounded = <T>(work: () => Promise<T>, fallback: T): Promise<T> =>
    new Promise<T>(resolve => {
      const timer = setTimeout(() => resolve(fallback), timeoutMs)
      Promise.resolve().then(work).then(
        value => { clearTimeout(timer); resolve(value) },
        () => { clearTimeout(timer); resolve(fallback) },
      )
    })

  const settled = <T>(work: () => Promise<T>): Promise<CloudResult<T>> =>
    new Promise(resolve => {
      const timer = setTimeout(() => resolve({ error: 'FKN storage did not answer' }), timeoutMs)
      Promise.resolve().then(work).then(
        ok => { clearTimeout(timer); resolve({ ok }) },
        error => { clearTimeout(timer); resolve(refusal(error)) },
      )
    })

  return {
    availability: () => bounded(async () => {
      const { fs } = (await lib.api()).cloud
      if (typeof fs.availability === 'function') return await fs.availability()
      return 'unknown'
    }, 'unknown' as CloudAvailability),
    unlocked: () => bounded(async () => (await lib.encryption()).unlocked === true, false),
    list: () => bounded(async (): Promise<CloudEntry[] | undefined> =>
      (await (await lib.api()).cloud.fs.list())
        .filter(entry => entry.path.startsWith(CLOUD_ROOT))
        .map(({ path, updatedAt }) => ({ path, updatedAt })), undefined),
    read: (path) => settled(async () => {
      const content = await lib.readFile(path, 'utf8')
      return typeof content === 'string' ? content : new TextDecoder().decode(content)
    }),
    write: (path, text) => settled(async () => { await lib.writeFile(path, text); return true as const }),
  }
}
