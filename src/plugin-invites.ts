import { comparablePluginUri } from './utils/plugin-links'
import { addedByLink, disablePlugin, enabledPluginUris, enablePlugin, installedPlugins, installPlugin, makeTemporary, showTemporary, supportsTemporary } from './plugins'

export type AddedInvite = {
  /** The source's id on the list, or the link's address when it could not be added. */
  uri: string
  failed?: true
  /** FKN can hold it for this tab alone, so Make temporary is offered. */
  offersTemporary?: true
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

const add = async (uri: string, installed: Awaited<ReturnType<typeof installedPlugins>>, offersTemporary: boolean) => {
  try {
    if (listedAs(uri)) return
    const holding = installed.find(record => comparablePluginUri(record.uri) === comparablePluginUri(uri))
    // made temporary in this tab, before a reload or on another of stub's sites: an install would keep it
    if (holding?.temporary) {
      showTemporary(holding.uri)
      return
    }
    // FKN keeps one install record for every site of an app, so a package it holds is a source of another
    // site, which is what stub's own site links carry: it joins this list with nothing to say, and a
    // version other than the one held is FKN's to confirm
    if (holding) {
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
    added.set(source.uri, { uri: source.uri, offersTemporary: offersTemporary || undefined })
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
  const installed = await installedPlugins().catch(() => undefined)
  if (!installed) return
  // FKN answered, so this does at once
  const offersTemporary = await supportsTemporary()
  await Promise.all(fresh.map(uri => add(uri, installed, offersTemporary)))
}

/** Keeps that one source for this tab alone, its row staying with Remove. */
export const makeInviteTemporary = (uri: string): void => { void makeTemporary(uri) }

export const removeInvite = (uri: string): void => {
  added.delete(uri)
  notify()
  void disablePlugin(uri)
}

export const closeInvites = (): void => {
  added.clear()
  notify()
}
