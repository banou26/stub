// The stub tracker's FKN storage over the real @fkn/lib. `trackerCloud` and `onTrackerAccountChange` are
// the worker's, where the tracker runs. `unlockTracker` is the page's: it is the one call here that
// raises a card, and it is only ever run from a click.

import { onChange } from '@fkn/lib/account'
import { availability, encryption, list, promises, unlock } from '@fkn/lib/cloud/fs'

import { fknTrackerCloud } from './fkn-cloud'

export const trackerCloud = fknTrackerCloud({
  availability,
  list,
  encryption,
  readFile: (path) => promises.readFile(path, { encoding: 'utf8' }),
  writeFile: (path, text) => promises.writeFile(path, text),
})

export const onTrackerAccountChange = onChange

/** Asks FKN for the key the account's list is sealed with. Raises the connect card: a click only. */
export const unlockTracker = () => unlock().catch(() => false)
