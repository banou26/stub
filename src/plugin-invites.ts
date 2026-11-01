import { comparablePluginUri } from './utils/plugin-links'
import { addedByLink, disablePlugin, enabledPluginUris, enablePlugin, installedPluginUris, installPlugin } from './plugins'

export type AddedInvite = {
  /** The source's id on the list, or the link's address when it could not be added. */
  uri: string
  failed?: true
}

const added = new Map<string, AddedInvite>()
const listeners = new Set<() => void>()

const notify = () => listeners.forEach(listener => { try { listener() } catch {} })

export const onInvitesChange = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const addedInvites = (): AddedInvite[] => [...added.values()]

// waiting on FKN, and kept on the url meanwhile
const held = new Set<string>()

export const pendingInviteUris = (): string[] => [...held]

const listedAs = (uri: string) =>
  enabledPluginUris().find(enabled => comparablePluginUri(enabled) === comparablePluginUri(uri))

const add = async (uri: string, installed: string[]) => {
  try {
    if (listedAs(uri)) return
    // FKN keeps one install record for every site of an app, so a package it holds is a source of another
    // site, which is what stub's own site links carry: it joins this list with nothing to say, and a
    // version other than the one held is FKN's to confirm
    if (installed.includes(comparablePluginUri(uri))) {
      await installPlugin(uri)
      return
    }
    const listed = enabledPluginUris()
    // null only comes back from a broker too old to honour noConfirm, which still confirms
    const source = await enablePlugin(uri, { noConfirm: true })
    // FKN may hold it under an id other than the link's, a bare https-pkg host for one
    if (!source || listed.includes(source.uri)) return
    addedByLink(source.uri)
    try {
      await source.connected
    } catch (error) {
      // nothing asked the viewer for it, so one that cannot connect is not kept
      void disablePlugin(source.uri)
      throw error
    }
    added.set(source.uri, { uri: source.uri })
  } catch (error) {
    console.warn(`Source '${uri}' could not be added:`, error)
    added.set(uri, { uri, failed: true })
  } finally {
    held.delete(uri)
    notify()
  }
}

/**
 * Adds the sources a link names that are not on the list, and says so through `addedInvites`. Only FKN's list
 * tells a link from stub's own mirror of another site's sources, and a site's first one may take seconds, so
 * it is waited for: with no broker an install would not answer either. A list that fails adds nothing and
 * leaves the link on the url for the next load.
 */
export const addInvites = async (uris: string[]): Promise<void> => {
  const fresh = uris.filter(uri => !listedAs(uri))
  if (!fresh.length) return
  for (const uri of fresh) held.add(uri)
  const installed = await installedPluginUris().catch(() => undefined)
  if (!installed) return
  const comparable = installed.map(comparablePluginUri)
  await Promise.all(fresh.map(uri => add(uri, comparable)))
}

export const removeInvite = (uri: string): void => {
  added.delete(uri)
  notify()
  void disablePlugin(uri)
}

export const closeInvites = (): void => {
  added.clear()
  notify()
}
