import { party } from '../../party'
import { disableAllPlugins } from '../../plugins'
import { clearKeys } from '../../utils/keys'

/**
 * The Data section's clear for an item that is more than its keys: the worker's copy of the keys, each
 * added source's connection and FKN install, the party name the store holds for this page. Each empties
 * the item's keys before anything is waited on, and none waits on FKN.
 */
export const clearers = {
  'api-keys': () => { void clearKeys() },
  'added-sources': () => { void disableAllPlugins() },
  'party-name': () => party.setName(undefined),
}
