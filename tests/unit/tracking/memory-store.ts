import type { JournalStore } from '../../../src/tracking/journal'

/**
 * One device's files shared by every journal opened over it, as two tabs of one origin share OPFS.
 * `move` is another tab starting a new device, as a sign out or an account switch does.
 */
export const memoryStore = (device = 'device-a') => {
  let current = device
  const texts = new Map<string, string>()
  let chain: Promise<unknown> = Promise.resolve()
  const store: JournalStore & { text: () => string | undefined, move: (next: string) => void } = {
    device: async () => current,
    read: async () => texts.get(current),
    write: async (next) => { texts.set(current, next) },
    exclusive: (work) => {
      const run = chain.then(work, work)
      chain = run.catch(() => {})
      return run
    },
    text: () => texts.get(current),
    move: (next) => { current = next },
  }
  return store
}
