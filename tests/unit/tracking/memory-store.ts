import type { JournalStore } from '../../../src/tracking/journal'

/** One file shared by every journal opened over it, as two tabs of one origin share OPFS. */
export const memoryStore = (device = 'device-a') => {
  let text: string | undefined
  let chain: Promise<unknown> = Promise.resolve()
  const store: JournalStore & { text: () => string | undefined } = {
    device: async () => device,
    read: async () => text,
    write: async (next) => { text = next },
    exclusive: (work) => {
      const run = chain.then(work, work)
      chain = run.catch(() => {})
      return run
    },
    text: () => text,
  }
  return store
}
