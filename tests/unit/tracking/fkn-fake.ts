import type { FknStorage } from '../../../src/tracking/fkn-cloud'
import type { Session, TrackerDisk } from '../../../src/tracking/account-link'

/**
 * FKN as the stub tracker meets it, faked at @fkn/lib's surface: accounts whose storage is kept apart
 * (each account's rows answer only to that account), and browsers each signed in to at most one.
 *
 * A browser's calls act as whichever account it is signed in to AT THE MOMENT OF THE CALL, as the
 * broker's do. What keeps a call in the account it was made for is the account pin, as @fkn/lib 0.9.41
 * builds it. Each realm (one page's worker) counts the account switches it has heard of; a call
 * captures that count before its first await and carries the pin taken for it, once per count, which
 * names the account signed in when it was taken. The api refuses a pin of another account before
 * anything else, the key check included, so a refused write raises no card. A switch moves every
 * realm's count before that realm's listeners run; a renewal of the same account's token moves nothing
 * and is still heard.
 *
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

  const browser = ({ account, unlocked = true, locked = [], pins = true }: {
    account?: string
    unlocked?: boolean
    /** accounts whose key this browser does not hold, whatever `unlocked` says */
    locked?: string[]
    /** false: a broker older than the account pin */
    pins?: boolean
  } = {}) => {
    const state = {
      account,
      unlocked,
      lockedFor: new Set(locked),
      pins,
      /** false: the broker never answers, the way a partition with no network looks */
      reachable: true,
      cards: 0,
      /** calls the api refused as another account's */
      refused: 0,
      reads: [] as string[],
      writes: [] as { account: string, path: string, text: string }[],
    }
    const realms = new Set<(switched: boolean) => void>()
    const signedIn = () => {
      if (!state.account) throw new Error('storage: not connected')
      return state.account
    }
    const holds = (account: string) => state.unlocked && !state.lockedFor.has(account)
    const keyHeld = (account: string) => {
      if (holds(account)) return
      state.cards += 1
      throw Object.assign(new Error('storage locked: connect the app again to open encrypted data'), { code: 'FKN_E2E_LOCKED' })
    }
    const answering = () => state.reachable ? Promise.resolve() : new Promise<never>(() => {})
    const changed = () => Object.assign(new Error('storage: the signed-in account changed, so this call was not made'), { code: 'FKN_ACCOUNT_CHANGED' })

    /** One @fkn/lib realm on this browser: a page's worker, with its own account count and pins. */
    const realm = () => {
      let generation = 0
      const pinOf = new Map<number, string>()
      const listeners = new Set<() => void>()
      realms.add(switched => {
        if (switched) generation += 1
        for (const listener of [...listeners]) listener()
      })

      // a storage call: its count captured as it is made, then its pin, then the api's checks in order
      const pinned = <T>(work: (account: string) => T): Promise<T> => {
        const captured = generation
        return (async () => {
          await answering()
          if (!state.pins) throw Object.assign(new Error('storage: the FKN broker cannot pin calls to an account yet, so nothing was sent'), { code: 'FKN_ACCOUNT_PIN_UNSUPPORTED' })
          if (!pinOf.has(captured)) {
            if (captured !== generation) throw changed()
            pinOf.set(captured, signedIn())
          }
          const account = signedIn()
          if (pinOf.get(captured) !== account) {
            state.refused += 1
            throw changed()
          }
          return work(account)
        })()
      }

      const lib: FknStorage = {
        availability: async () => {
          await answering()
          return state.account ? 'connected' : 'disconnected'
        },
        list: () => pinned(account => [...storageOf(account)].map(([path, { updatedAt }]) => ({ path, updatedAt }))),
        encryption: async () => {
          await answering()
          return { unlocked: Boolean(state.account) && holds(state.account!) }
        },
        readFile: (path) => pinned(account => {
          keyHeld(account)
          state.reads.push(path)
          if (retired.has(path)) throw new Error('fkn:e2e-stale-epoch: sealed under a key this account has reset')
          const found = storageOf(account).get(path)
          if (!found) throw Object.assign(new Error('Not found'), { code: 'FKN_STORAGE_NOT_FOUND' })
          return found.text
        }),
        writeFile: (path, text) => pinned(account => {
          keyHeld(account)
          storageOf(account).set(path, { text, updatedAt: new Date(1_000_000 + ++written).toISOString() })
          state.writes.push({ account, path, text })
        }),
      }

      /** `account.onChange` of @fkn/lib in this realm. */
      const onChange = async (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }

      return { lib, onChange }
    }

    const notify = (switched: boolean) => { for (const hear of [...realms]) hear(switched) }

    /** The viewer's hands on FKN, and the broker's notifications of what they did. */
    const account_ = {
      signIn: (name: string) => {
        const switched = state.account !== name
        state.account = name
        notify(switched)
      },
      signOut: () => {
        const switched = state.account !== undefined
        state.account = undefined
        notify(switched)
      },
      /** The same account's token renewed: heard by every realm, a switch to none. */
      renew: () => notify(false),
      /** The notification of a switch already made with `state.account`, arriving late. */
      notify: () => notify(true),
      /** `cloud.fs.unlock()`: the card, and the key it delivers. Only a click ever calls it. */
      unlock: async () => {
        state.cards += 1
        state.unlocked = true
        if (state.account) state.lockedFor.delete(state.account)
        return true
      },
    }

    return { state, realm, account: account_, ...realm() }
  }

  /** Every entry an account's tracker files hold, by the progress each one carries. A marker holds none. */
  const entriesIn = (account: string) =>
    [...storageOf(account).values()].flatMap(({ text }) => (JSON.parse(text) as { entries?: { fields: Record<string, { value: unknown }> }[] }).entries ?? [])

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
