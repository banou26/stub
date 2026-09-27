// The stub tracker's FKN storage over the real @fkn/lib, on the main thread. `unlock` is the one call
// here that raises a card, and it is only ever run from a click.

import { apiPromise } from '@fkn/lib/api'
import { encryption, promises, unlock } from '@fkn/lib/cloud/fs'

import { fknTrackerCloud } from './fkn-cloud'

export const trackerCloud = fknTrackerCloud({
  api: () => apiPromise,
  encryption,
  readFile: (path) => promises.readFile(path, { encoding: 'utf8' }),
  writeFile: (path, text) => promises.writeFile(path, text),
})

/** Asks FKN for the key the account's list is sealed with. Raises the connect card: a click only. */
export const unlockTracker = () => unlock().catch(() => false)
