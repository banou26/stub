import { comparablePluginUri } from './utils/plugin-links'
import { enabledPluginUris, enablePlugin, installedPluginUris, installPlugin, onPluginsChange } from './plugins'

export type PluginInvite = {
  uri: string
  state: 'offered' | 'installing' | 'error'
}

const invites = new Map<string, PluginInvite>()
// outlives the offer, or the next navigation re-reads the url and asks again
const declined = new Set<string>()
const listeners = new Set<() => void>()

const notify = () => listeners.forEach(listener => { try { listener() } catch {} })

export const onInvitesChange = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const pluginInvites = (): PluginInvite[] => [...invites.values()]

// waiting on FKN's list, and kept on the url meanwhile
const held = new Set<string>()

export const pendingInviteUris = (): string[] => [...invites.keys(), ...held]

const knownUris = () => new Set(enabledPluginUris().map(comparablePluginUri))

// On production, 2026-10-31, FKN's list answered a sibling site's first call in 300 to 370 ms, and in 4 of
// 8 loads about 25 ms after the dialog had rendered, so offering first would flash it up and away. A
// broker that never answers costs this wait, then the offer as before.
const LIST_WAIT_MS = 1_500

const listed = (): Promise<Set<string>> => Promise.race([
  installedPluginUris().then(uris => new Set(uris.map(comparablePluginUri)), () => new Set<string>()),
  new Promise<Set<string>>(resolve => setTimeout(() => resolve(new Set()), LIST_WAIT_MS)),
])

const offerable = (uri: string) => {
  const key = comparablePluginUri(uri)
  return Boolean(key) && !knownUris().has(key) && !declined.has(key) && !invites.has(uri) && !held.has(uri)
}

// FKN keeps one install record for every site of an app, so a link can name a package another of its
// sites installed: that one is added without asking, and FKN decides whether to say so
export const offerInvites = async (uris: string[]): Promise<void> => {
  const fresh = uris.filter(offerable)
  if (!fresh.length) return
  for (const uri of fresh) held.add(uri)
  const installed = await listed()
  let added = false
  for (const uri of fresh) {
    held.delete(uri)
    if (!offerable(uri)) continue
    if (installed.has(comparablePluginUri(uri))) {
      installPlugin(uri).catch(error => console.warn(`Source '${uri}' could not be added:`, error))
      continue
    }
    invites.set(uri, { uri, state: 'offered' })
    added = true
  }
  if (added) notify()
}

// a link is read before the account's list arrives, so an offer it already holds is withdrawn then
onPluginsChange(() => {
  const known = knownUris()
  let dropped = false
  for (const [uri, invite] of invites) {
    if (invite.state !== 'offered' || !known.has(comparablePluginUri(uri))) continue
    invites.delete(uri)
    dropped = true
  }
  if (dropped) notify()
})

export const declineInvites = (): void => {
  if (!invites.size) return
  for (const uri of invites.keys()) declined.add(comparablePluginUri(uri))
  invites.clear()
  notify()
}

// one failure does not cancel the rest: a link can carry several addresses and only one be dead
export const acceptInvites = async (): Promise<void> => {
  const pending = [...invites.keys()]
  if (!pending.length) return
  for (const uri of pending) invites.set(uri, { uri, state: 'installing' })
  notify()
  for (const uri of pending) {
    try {
      // noConfirm: this dialog is the consent, so FKN notifies instead of confirming; null only comes
      // back from a broker too old to honour it, which still confirms and can still be refused
      if (!await enablePlugin(uri, { noConfirm: true })) declined.add(comparablePluginUri(uri))
      invites.delete(uri)
    } catch (error) {
      console.warn(`Source '${uri}' could not be added:`, error)
      invites.set(uri, { uri, state: 'error' })
    }
    notify()
  }
}

export const dismissInvite = (uri: string): void => {
  if (!invites.delete(uri)) return
  declined.add(comparablePluginUri(uri))
  notify()
}
