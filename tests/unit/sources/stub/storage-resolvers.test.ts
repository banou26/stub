// Where stub's own list stands, as the page asks for it: over the real link, with FKN faked at
// @fkn/lib's surface. The "Add" the page offers is the only way a list kept on a device reaches an
// account, so the mutation behind it is pinned end to end here.
import { afterEach, expect, test } from 'vitest'

import { accountLink, journalStoreOver } from '../../../../src/tracking/account-link'
import { fknTrackerCloud } from '../../../../src/tracking/fkn-cloud'
import { identify, type MediaIdentity } from '../../../../src/tracking/identity'
import { openJournal } from '../../../../src/tracking/journal'
import { stubStorageResolvers } from '../../../../src/sources/stub/storage-resolvers'
import { fknWorld, memoryDisk, mutex } from '../../tracking/fkn-fake'
import { providerServer, subscribe, yogaClient } from '../../worker/yoga-client'

const STORAGE = 'subscription { stubTrackerStorage { location signedIn locked waiting held error } }'
const ADD = 'mutation { addHeldStubEntries { location held error } }'
const FRIEREN = identify('ag:(anilist:1)') as Extract<MediaIdentity, { kind: 'catalogue' }>

let minted = 0
const deps = { now: () => 1_700_000_000_000 + minted * 1_000, uuid: () => `id-${++minted}` }

const live: { close: () => void }[] = []
afterEach(() => { while (live.length) live.pop()!.close() })

test('streams where the list stands, and adds the list kept before signing in only when asked', async () => {
  const world = fknWorld()
  const browser = world.browser()
  const disk = memoryDisk(deps.uuid)
  const journal = await openJournal(journalStoreOver(disk), deps)
  const link = accountLink({ disk, journal, cloud: fknTrackerCloud(browser.lib, { timeoutMs: 20 }), onAccountChange: browser.onChange, lock: mutex(), ...deps, uploadDelayMs: 60_000 })
  const target = providerServer('stub', stubStorageResolvers(async () => link))

  await link.check()
  await journal.save(FRIEREN, { progress: 2 })
  browser.account.signIn('alice')
  await link.check()

  const storage = subscribe(target, STORAGE, {})
  live.push(storage)
  expect((await storage.next()).data.stubTrackerStorage).toEqual({ location: 'ACCOUNT', signedIn: true, locked: false, waiting: false, held: 1, error: null })
  expect(world.entriesIn('alice')).toEqual([])

  const added = await yogaClient(target).mutation(ADD, {}).toPromise()
  expect(added.data.addHeldStubEntries).toEqual({ location: 'ACCOUNT', held: 0, error: null })
  expect((await storage.until(result => result.data.stubTrackerStorage.held === 0)).data.stubTrackerStorage.held).toBe(0)
  await link.idle()
  expect(world.entriesIn('alice')).toHaveLength(1)
})
