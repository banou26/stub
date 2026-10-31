import type { InstallOptions } from '@fkn/lib/packages'

import { packages } from '@fkn/lib'

import { configureRemoteSource, registerRemoteSource, unregisterRemoteSource } from './worker'
import { STUB_SOURCE_PROTOCOL, type PluginSettingField, type SourceAccess } from './plugin-api'
import { loadEnabled, loadPluginValues, savePluginValues, type PluginEdits } from './plugin-list'
import { sourceListSync } from './plugin-sync'
import { onTrackerAccountChange, trackerCloud, unlockTracker } from './tracking/fkn-cloud-live'
import { comparablePluginUri } from './utils/plugin-links'

const RECONNECT_DELAY_MS = 3_000

export type PluginStatus = {
  uri: string
  state: 'connecting' | 'connected' | 'error'
  /** while connecting, that the source already connected or failed in this page and this is its retry */
  retry?: true
  /** every source the package registered, and what playing its releases needs; one package may ship a family of them */
  sources?: { origin: string, name: string, icon?: string | null, isApiOnly?: boolean, access?: SourceAccess }[]
  /** sources the package declared that could not be registered; the rest still serve */
  rejected?: { origin: string, reason: string }[]
  /** what the package asks the viewer for, known once it connected */
  settings?: PluginSettingField[]
}

const statuses = new Map<string, PluginStatus>()
const listeners = new Set<() => void>()

const notify = () => listeners.forEach(listener => { try { listener() } catch {} })

export const onPluginsChange = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const pluginStatuses = (): PluginStatus[] =>
  loadEnabled().map(uri => statuses.get(uri) ?? { uri, state: 'connecting' })

export const enabledPluginUris = (): string[] => loadEnabled()

/** The ids of the packages FKN holds installed for this app, whichever of its sites installed them. */
export const installedPluginUris = async (): Promise<string[]> =>
  (await packages.list()).map(installed => installed.uri)

// FKN's list never settles when no broker answers, and a website's first one may wait 3 s on FKN's own api
const LIST_WAIT_MS = 5_000

// FKN keeps one install record for every site of this app, so a source removed on another site fails to
// connect here. Only FKN's list answering without it says so; a failure, or no answer, says nothing.
const unheld = async (uri: string): Promise<boolean> => {
  const held = await Promise.race([
    installedPluginUris(),
    new Promise<undefined>(resolve => setTimeout(resolve, LIST_WAIT_MS)),
  ]).catch(() => undefined)
  return held !== undefined && !held.some(installed => comparablePluginUri(installed) === comparablePluginUri(uri))
}

const setStatus = (uri: string, status: Omit<PluginStatus, 'uri'>) => {
  statuses.set(uri, { uri, ...status })
  notify()
}

const CONNECT_TIMEOUT_MS = 45_000

const withDeadline = <T>(promise: Promise<T>, message: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), CONNECT_TIMEOUT_MS)),
  ])

const connected = new Set<string>()
// what each source registered in this page last took, as JSON
const handed = new Map<string, string>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const RECONNECT_MAX_MS = 30_000

const scheduleReconnect = (uri: string, attempt: number) => {
  if (!loadEnabled().includes(uri) || connected.has(uri) || retryTimers.has(uri)) return
  // keep a recorded failure on screen while the retry is pending
  if (statuses.get(uri)?.state !== 'error') setStatus(uri, { state: 'connecting', retry: true })
  const delay = Math.min(RECONNECT_DELAY_MS * attempt, RECONNECT_MAX_MS)
  const timer = setTimeout(() => {
    retryTimers.delete(uri)
    connectPlugin(uri, attempt + 1).catch(() => {})
  }, delay)
  retryTimers.set(uri, timer)
}

const connectPlugin = async (uri: string, attempt = 1): Promise<void> => {
  if (connected.has(uri)) return
  connected.add(uri)
  setStatus(uri, attempt > 1 ? { state: 'connecting', retry: true } : { state: 'connecting' })
  try {
    // `connected` is claimed before the attempt succeeds, so an attempt that never settles holds the slot forever
    const { port, closed } = await withDeadline<{ port: MessagePort, closed: Promise<void> }>(
      packages.connect(uri, { protocol: STUB_SOURCE_PROTOCOL, raw: true }),
      `connecting to '${uri}' timed out`,
    )
    // wire teardown BEFORE the worker handshake: a frame death mid-registration must still recover
    void closed.then(() => {
      connected.delete(uri)
      void unregisterRemoteSource(uri)
      scheduleReconnect(uri, 1)
    })
    const values = loadPluginValues(uri)
    const result = await withDeadline(Promise.race([
      registerRemoteSource(port, uri, values),
      closed.then(() => ({ error: 'the plugin closed while connecting' as string })),
    ]), `'${uri}' did not finish connecting`)
    if ('error' in result) throw new Error(result.error)
    setStatus(uri, { state: 'connected', sources: result.ok.sources, rejected: result.ok.rejected, settings: result.ok.settings })
    // the worker can only hand values over from here, so what the account sent while it registered goes now
    handed.set(uri, JSON.stringify(values))
    followValues()
  } catch (error) {
    console.warn(`Plugin '${uri}' failed to connect:`, error)
    // the slot stays claimed while FKN is asked, so nothing reconnects meanwhile
    if (await unheld(uri)) await sourceList.forget(uri)
    if (!loadEnabled().includes(uri)) {
      disconnect(uri)
      notify()
      throw error
    }
    connected.delete(uri)
    setStatus(uri, { state: 'error' })
    // registration errors leave the frame alive, so `closed` never fires: the reconnect comes from here
    scheduleReconnect(uri, attempt + 1)
    throw error
  }
}

// another site saved them, or they came with the account: a source already connected takes them now
const followValues = () => {
  let moved = false
  for (const [uri, text] of handed) {
    const values = loadPluginValues(uri)
    if (JSON.stringify(values) === text) continue
    handed.set(uri, JSON.stringify(values))
    configureRemoteSource(uri, values).catch(() => {})
    moved = true
  }
  if (moved) notify()
}

const cancelReconnect = (uri: string) => {
  const timer = retryTimers.get(uri)
  if (timer !== undefined) { clearTimeout(timer); retryTimers.delete(uri) }
}

// the source left this site, by any way a source leaves it, so what the viewer entered for it goes too
const disconnect = (uri: string) => {
  cancelReconnect(uri)
  connected.delete(uri)
  statuses.delete(uri)
  handed.delete(uri)
  savePluginValues(uri, {})
  void unregisterRemoteSource(uri)
}

// The list changed under this page: the account's list arrived, changed on another site, device or tab,
// or left at sign out. A source new here is installed without FKN's confirm, since the viewer approved it
// when they added it; FKN shows its own notice only when no site of this app installed it on this device.
const follow = (before: string[], after: string[]) => {
  for (const uri of before) {
    if (after.includes(uri)) continue
    disconnect(uri)
    packages.uninstall(uri).catch(() => {})
  }
  notify()
  for (const uri of after) {
    if (before.includes(uri)) continue
    packages.install(uri, { noConfirm: true })
      .then(installed => {
        if (!installed) throw new Error(`FKN did not install '${uri}'`)
        connectPlugin(uri).catch(() => {})
      })
      .catch(error => {
        console.warn(`Plugin '${uri}' could not be installed:`, error)
        setStatus(uri, { state: 'error' })
      })
  }
}

// one step at a time across every tab of the origin, or two tabs adding at once could each write the
// account's file without the other's source
const listLock = <T>(work: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('stub:source-list', work)
    : work()

const sourceList = sourceListSync({ cloud: trackerCloud, onAccountChange: onTrackerAccountChange, lock: listLock, onList: follow, onValues: followValues, unlock: unlockTracker })

/** Brings the list in line with the FKN account's: at start, and whenever the page asks again. */
export const checkSources = () => sourceList.check()

// install through FKN first and only persist to the enabled list once it took: FKN refuses to connect a package this app has not installed, so a mistyped address written straight to the list is retried forever
// key everything on the id FKN hands back, never the caller's string: FKN canonicalizes a version away ('npm:x@1.2.3' installs as 'npm:x')
const install = async (uri: string, options?: InstallOptions): Promise<string | null> => {
  const installed = await packages.install(uri, options)
  if (!installed) return null
  void sourceList.add(installed.uri)
  return installed.uri
}

/**
 * Installs a package and adds it to the list, resolving with its id once FKN has installed it, or null
 * when the viewer declines FKN's confirm. Rejects only when FKN refuses the install. The connection is
 * started and not waited for: its state, a failure included, is the list's to show.
 */
export const installPlugin = async (uri: string): Promise<string | null> => {
  const installed = await install(uri)
  if (installed) connectPlugin(installed).catch(() => {})
  return installed
}

/** As `installPlugin`, but settles once the source has connected, and rejects when it cannot. */
export const enablePlugin = async (uri: string, options?: InstallOptions): Promise<string | null> => {
  const installed = await install(uri, options)
  if (installed) await connectPlugin(installed)
  return installed
}

export const disablePlugin = async (uri: string): Promise<void> => {
  void sourceList.remove(uri)
  disconnect(uri)
  // told before the uninstall, which FKN may never answer
  notify()
  await packages.uninstall(uri).catch(() => {})
}

/** Applies what the viewer changed for a source, on the account while one is in use here, and hands the source its values at once. */
export const configurePlugin = async (uri: string, edits: PluginEdits): Promise<void> => {
  void sourceList.save(uri, edits)
  const values = loadPluginValues(uri)
  handed.set(uri, JSON.stringify(values))
  notify()
  await configureRemoteSource(uri, values)
}

// picks over npm packages tagged fkn-plugin--stub
export const addPlugins = async (): Promise<void> => {
  const picked = await packages.pick(
    { type: 'plugin', id: 'stub' },
    { multiple: true, title: 'Add stub sources' },
  )
  for (const result of picked) {
    await enablePlugin(result.uri).catch(() => {})
  }
}

for (const uri of loadEnabled()) {
  connectPlugin(uri).catch(() => {})
}
