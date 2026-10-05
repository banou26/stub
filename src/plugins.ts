import type { InstallOptions } from '@fkn/lib/packages'

import { packages } from '@fkn/lib'

import { registerRemoteSource, unregisterRemoteSource } from './worker'
import { STUB_SOURCE_PROTOCOL } from './plugin-api'
import { loadEnabled, saveEnabled } from './plugin-list'

const RECONNECT_DELAY_MS = 3_000

export type PluginStatus = {
  uri: string
  state: 'connecting' | 'connected' | 'error'
  /** every source the package registered; one package may ship a family of them */
  sources?: { origin: string, name: string }[]
  /** sources the package declared that could not be registered; the rest still serve */
  rejected?: { origin: string, reason: string }[]
  error?: string
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
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const RECONNECT_MAX_MS = 30_000

const scheduleReconnect = (uri: string, attempt: number) => {
  if (!loadEnabled().includes(uri) || connected.has(uri) || retryTimers.has(uri)) return
  // keep a recorded failure on screen while the retry is pending
  if (statuses.get(uri)?.state !== 'error') setStatus(uri, { state: 'connecting' })
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
  setStatus(uri, { state: 'connecting' })
  try {
    // `connected` is claimed before the attempt succeeds, so an attempt that never settles holds the slot forever
    const { port, closed } = await withDeadline<{ port: MessagePort, closed: Promise<void> }>(
      packages.connect(uri, { protocol: STUB_SOURCE_PROTOCOL, raw: true }),
      `connecting to '${uri}' timed out`,
    )
    // wire teardown BEFORE the worker handshake: a frame death mid-registration must still recover
    closed.then(() => {
      connected.delete(uri)
      unregisterRemoteSource(uri)
      scheduleReconnect(uri, 1)
    })
    const result = await withDeadline(Promise.race([
      registerRemoteSource(port, uri),
      closed.then(() => ({ error: 'the package closed before the source registered' as string })),
    ]), `'${uri}' connected but never registered its source`)
    if ('error' in result) throw new Error(result.error)
    setStatus(uri, { state: 'connected', sources: result.ok.sources, rejected: result.ok.rejected })
  } catch (error) {
    connected.delete(uri)
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Plugin '${uri}' failed to connect:`, error)
    setStatus(uri, { state: 'error', error: message })
    // registration errors leave the frame alive, so `closed` never fires: the reconnect comes from here
    scheduleReconnect(uri, attempt + 1)
    throw error
  }
}

const cancelReconnect = (uri: string) => {
  const timer = retryTimers.get(uri)
  if (timer !== undefined) { clearTimeout(timer); retryTimers.delete(uri) }
}

// install through FKN first and only persist to the enabled list once it took: FKN refuses to connect a package this app has not installed, so a mistyped address written straight to the list is retried forever
// key everything on the id FKN hands back, never the caller's string: FKN canonicalizes a version away ('npm:x@1.2.3' installs as 'npm:x')
export const enablePlugin = async (uri: string, options?: InstallOptions): Promise<string | null> => {
  const installed = await packages.install(uri, options)
  if (!installed) return null
  saveEnabled([...new Set([...loadEnabled(), installed.uri])])
  await connectPlugin(installed.uri)
  return installed.uri
}

export const disablePlugin = async (uri: string): Promise<void> => {
  saveEnabled(loadEnabled().filter(enabled => enabled !== uri))
  cancelReconnect(uri)
  connected.delete(uri)
  statuses.delete(uri)
  unregisterRemoteSource(uri)
  // told before the uninstall, which FKN may never answer
  notify()
  await packages.uninstall(uri).catch(() => {})
}

/**
 * Removes every added source, as Remove does for one. The list in this browser is emptied before this
 * returns; what it resolves on is FKN uninstalling each package, which may never answer.
 */
export const disableAllPlugins = (): Promise<void> =>
  Promise.all(loadEnabled().map(disablePlugin)).then(() => {})

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
