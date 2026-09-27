import type { FknStorage } from '../../../src/tracking/fkn-cloud'
import type { Session, TrackerDisk } from '../../../src/tracking/account-link'

/**
 * FKN as the stub tracker meets it, faked at @fkn/lib's surface: accounts whose storage is kept apart
 * (each account's rows answer only to that account), and browsers each signed in to at most one.
 *
 * A browser's calls act as whichever account it is signed in to AT THE MOMENT OF THE CALL, as the
 * broker's do, which is exactly what lets a careless client upload one account's list into another.
 * A sealed read or write with no key held raises the connect card, as the broker's `keyFor` does,
 * and is counted: the locked path must never reach one.
 */
export const fknWorld = () => {
  const accounts = new Map<string, Map<string, { text: string, updatedAt: string }>>()
  /** Paths sealed under a key the account has since reset: listed, and never opened again. */
  const retired = new Set<string>()
  let written = 0
  const storageOf = (account: string) => {
    let storage = accounts.get(account)
    if (!storage) accounts.set(account, storage = new Map())
    return storage
  }

  const browser = ({ account, unlocked = true }: { account?: string, unlocked?: boolean } = {}) => {
    const state = {
      account,
      unlocked,
      /** false: the broker never answers, the way a partition with no network looks */
      reachable: true,
      cards: 0,
      reads: [] as string[],
      writes: [] as { account: string, path: string, text: string }[],
    }
    const listeners = new Set<() => void>()
    const signedIn = () => {
      if (!state.account) throw new Error('storage: not connected')
      return state.account
    }
    const keyHeld = () => {
      if (state.unlocked) return
      state.cards += 1
      throw Object.assign(new Error('storage locked: connect the app again to open encrypted data'), { code: 'FKN_E2E_LOCKED' })
    }
    const answering = () => state.reachable ? Promise.resolve() : new Promise<never>(() => {})

    const lib: FknStorage = {
      api: async () => {
        await answering()
        return {
          cloud: {
            fs: {
              availability: async () => state.account ? 'connected' : 'disconnected',
              list: async () => [...storageOf(signedIn())].map(([path, { updatedAt }]) => ({ path, updatedAt })),
            },
          },
        }
      },
      encryption: async () => {
        await answering()
        return { unlocked: Boolean(state.account) && state.unlocked }
      },
      readFile: async (path) => {
        await answering()
        const account = signedIn()
        keyHeld()
        state.reads.push(path)
        if (retired.has(path)) throw new Error('fkn:e2e-stale-epoch: sealed under a key this account has reset')
        const found = storageOf(account).get(path)
        if (!found) throw Object.assign(new Error('Not found'), { code: 'FKN_STORAGE_NOT_FOUND' })
        return found.text
      },
      writeFile: async (path, text) => {
        await answering()
        const account = signedIn()
        keyHeld()
        storageOf(account).set(path, { text, updatedAt: new Date(1_000_000 + ++written).toISOString() })
        state.writes.push({ account, path, text })
      },
    }

    /** @fkn/lib's `account`, as far as the tracker uses it, and the viewer's hands on it. */
    const account_ = {
      onChange: async (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      signIn: (name: string) => {
        state.account = name
        for (const listener of listeners) listener()
      },
      signOut: () => {
        state.account = undefined
        for (const listener of listeners) listener()
      },
      /** `cloud.fs.unlock()`: the card, and the key it delivers. Only a click ever calls it. */
      unlock: async () => {
        state.cards += 1
        state.unlocked = true
        return true
      },
    }

    return { state, lib, account: account_ }
  }

  /** Every entry an account's tracker files hold, by the progress each one carries. */
  const entriesIn = (account: string) =>
    [...storageOf(account).values()].flatMap(({ text }) => (JSON.parse(text) as { entries: { fields: Record<string, { value: unknown }> }[] }).entries)

  return { accounts, retired, storageOf, browser, entriesIn }
}

/** A device's disk in memory, shared by every tab of that device. */
export const memoryDisk = (mint: () => string) => {
  const files = new Map<string, string>()
  let session: Session | undefined
  let chain: Promise<unknown> = Promise.resolve()
  const disk: TrackerDisk & { files: Map<string, string> } = {
    session: async () => (session ??= { id: mint(), scope: 'device', uploaded: 0 }),
    setSession: async (next) => { session = next },
    read: async (name) => files.get(name),
    write: async (name, text) => { files.set(name, text) },
    remove: async (name) => { files.delete(name) },
    exclusive: (work) => {
      const run = chain.then(work, work)
      chain = run.catch(() => {})
      return run
    },
    files,
  }
  return disk
}

/** One link step at a time, as the origin's Web Lock gives across a device's tabs. */
export const mutex = () => {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work)
    chain = run.catch(() => {})
    return run
  }
}
