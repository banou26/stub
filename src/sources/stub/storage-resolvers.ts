// Where the stub tracker's list stands on this device, served to the page over the link it is handed,
// so a test can hand it one over fakes. ./tracker.ts hands it this device's.

import type { Resolvers, StubTrackerStorage } from '../../generated/schema/types.generated'
import type { AccountLink, LinkStatus } from '../../tracking/account-link'

import { changes } from '../../tracking/collect'

const storageOf = (status: LinkStatus, error?: string): StubTrackerStorage => ({
  location: status.where === 'account' ? 'ACCOUNT' : 'DEVICE',
  signedIn: status.signedIn,
  locked: status.locked,
  waiting: status.waiting,
  held: status.held,
  error: error ?? status.error,
})

export const stubStorageResolvers = (link: () => Promise<AccountLink>) => ({
  Subscription: {
    stubTrackerStorage: {
      subscribe: async function* (_parent: unknown, _args: unknown, ctx: { request: { signal: AbortSignal } }) {
        const current = await link()
        yield { stubTrackerStorage: storageOf(current.status()) }
        for await (const _ of changes(current.onStatus, { signal: ctx.request.signal })) {
          yield { stubTrackerStorage: storageOf(current.status()) }
        }
      }
    }
  },
  Mutation: {
    addHeldStubEntries: async (): Promise<StubTrackerStorage> => {
      const current = await link()
      const refused = await current.addHeld()
      return storageOf(current.status(), refused)
    },
  },
}) satisfies Resolvers
