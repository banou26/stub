import { comparablePluginUri } from './utils/plugin-links'
import { enabledPluginUris, enablePlugin, onPluginsChange } from './plugins'

export type PluginInvite = {
  uri: string
  state: 'offered' | 'installing' | 'error'
  error?: string
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

export const pendingInviteUris = (): string[] => [...invites.keys()]

const knownUris = () => new Set(enabledPluginUris().map(comparablePluginUri))

export const offerInvites = (uris: string[]): void => {
  const known = knownUris()
  let added = false
  for (const uri of uris) {
    const key = comparablePluginUri(uri)
    if (!key || known.has(key) || declined.has(key) || invites.has(uri)) continue
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
      invites.set(uri, { uri, state: 'error', error: error instanceof Error ? error.message : String(error) })
    }
    notify()
  }
}

export const dismissInvite = (uri: string): void => {
  if (!invites.delete(uri)) return
  declined.add(comparablePluginUri(uri))
  notify()
}
