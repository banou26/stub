// FKN storage for the stub tracker, over the @fkn/lib calls it is handed. Import free, so a test hands
// it fakes of those calls; tracking/fkn-cloud-live.ts hands it the real ones. Runs in the worker, which
// reaches FKN through the page's relay (src/worker.ts), so the calls and the account change notification
// the tracker listens to are the same realm's.

import type { CloudAvailability, CloudEntry, CloudResult, TrackerCloud } from './account-link'

import { CLOUD_ROOT } from './account-link'

/** The slice of `@fkn/lib/cloud/fs` this adapter calls: `availability`, `list`, `encryption`, `promises`. */
export type FknStorage = {
  availability: () => Promise<CloudAvailability>
  list: () => Promise<{ path: string, updatedAt: string }[]>
  encryption: () => Promise<{ unlocked: boolean }>
  readFile: (path: string) => Promise<string | Uint8Array>
  writeFile: (path: string, text: string) => Promise<void>
}

// the codes @fkn/lib/cloud/fs mints (`StorageLockedError`, `StorageNotFoundError`,
// `StorageAccountChangedError`, `StorageAccountPinUnsupportedError`), and the account change's message
// prefix, which `isAccountChanged` also accepts
const LOCKED = 'FKN_E2E_LOCKED'
const NOT_FOUND = 'FKN_STORAGE_NOT_FOUND'
const ACCOUNT_CHANGED = 'FKN_ACCOUNT_CHANGED'
const ACCOUNT_CHANGED_MESSAGE = 'fkn:account-changed'
const PIN_UNSUPPORTED = 'FKN_ACCOUNT_PIN_UNSUPPORTED'

export const PIN_UNSUPPORTED_TEXT = 'FKN has to update before this list can reach your FKN account'

const refusal = (error: unknown): Exclude<CloudResult<never>, { ok: never }> => {
  const code = (error as { code?: string } | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === LOCKED) return { locked: true }
  if (code === NOT_FOUND) return { missing: true }
  // never retried here: the same call would carry the same account and be refused again
  if (code === ACCOUNT_CHANGED || message.startsWith(ACCOUNT_CHANGED_MESSAGE)) return { changed: true }
  if (code === PIN_UNSUPPORTED) return { error: PIN_UNSUPPORTED_TEXT }
  return { error: message }
}

/**
 * The tracker's view of FKN storage.
 *
 * Every call is bounded: an answer that never comes must read as "could not tell", never as a sign
 * out. `list`, `read` and `write` call @fkn/lib before returning, never a microtask later, as
 * `TrackerCloud` promises.
 */
export const fknTrackerCloud = (lib: FknStorage, { timeoutMs = 8_000 }: { timeoutMs?: number } = {}): TrackerCloud => {
  const bounded = <T>(work: () => Promise<T>, fallback: T): Promise<T> =>
    new Promise<T>(resolve => {
      const timer = setTimeout(() => resolve(fallback), timeoutMs)
      new Promise<T>(called => called(work())).then(
        value => { clearTimeout(timer); resolve(value) },
        () => { clearTimeout(timer); resolve(fallback) },
      )
    })

  const settled = <T>(work: () => Promise<T>): Promise<CloudResult<T>> =>
    new Promise(resolve => {
      const timer = setTimeout(() => resolve({ error: 'FKN storage did not answer' }), timeoutMs)
      new Promise<T>(called => called(work())).then(
        ok => { clearTimeout(timer); resolve({ ok }) },
        error => { clearTimeout(timer); resolve(refusal(error)) },
      )
    })

  return {
    availability: () => bounded(() => lib.availability(), 'unknown' as CloudAvailability),
    unlocked: () => bounded(async () => (await lib.encryption()).unlocked === true, false),
    list: () => settled(async (): Promise<CloudEntry[]> =>
      (await lib.list())
        .filter(entry => entry.path.startsWith(CLOUD_ROOT))
        .map(({ path, updatedAt }) => ({ path, updatedAt }))),
    read: (path) => settled(async () => {
      const content = await lib.readFile(path)
      return typeof content === 'string' ? content : new TextDecoder().decode(content)
    }),
    write: (path, text) => settled(async () => { await lib.writeFile(path, text); return true as const }),
  }
}
