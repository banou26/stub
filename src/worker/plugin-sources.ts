// nothing here touches the graph or the source barrel, so it stays importable outside a browser

import type { PluginSettingField, PluginSettingKind, PluginValues, SourceAccess, SourceAccount } from '../plugin-api'

/** A short lowercase token. Origins name things across the store, the UI and the uri grammar. */
export const PLUGIN_ORIGIN_TOKEN = /^[a-z0-9][a-z0-9-]{0,31}$/

export type PluginSourceInput = {
  origin?: unknown
  originUrl?: unknown
  name?: unknown
  icon?: unknown
  color?: unknown
  isApiOnly?: unknown
  metadataOnly?: unknown
  access?: unknown
  resolvers?: unknown
}

/** Everything about a source except its resolvers, which only extractor.ts can build. */
export type PluginSourceMeta = {
  origin: string
  originUrl: string
  name: string
  icon: string | null
  color: string | null
  isApiOnly: boolean
  metadataOnly: boolean
  access: SourceAccess
}

export type RejectedSource = { origin: string, reason: string }

/** What the page learns of a source that registered: how Settings names and draws its card, and what Play weighs. */
export type RegisteredSource = Pick<PluginSourceMeta, 'origin' | 'name' | 'icon' | 'isApiOnly' | 'access'>

// the single-source shape stays supported: it is what the example plugin and every plugin written before this sends
/**
 * The sources a payload declares, each validated on its own.
 *
 * A payload is either ONE source, or a `sources` list so a single package can ship a family of them
 * (an indexer package serving animetosho and nyaa, say). The single shape stays supported because it
 * is what the example plugin and every plugin written before this sends.
 *
 * A source in a family is an ordinary standalone source that happens to arrive over a shared
 * connection. So a malformed one is REPORTED and skipped, never fatal to its siblings: the same rule
 * the fan-out follows for a failing extractor and the source layer follows for a bad record. Dropping
 * the whole family because one entry is wrong would make a package strictly more fragile than the
 * same sources shipped separately, which is backwards.
 */
export const readPluginSources = (
  payload: PluginSourceInput & { sources?: unknown },
  pluginUri: string
): { sources: { meta: PluginSourceMeta, source: PluginSourceInput }[], rejected: RejectedSource[] } => {
  const incoming: PluginSourceInput[] =
    Array.isArray(payload.sources) && payload.sources.length
      ? payload.sources as PluginSourceInput[]
      : [payload]

  const sources: { meta: PluginSourceMeta, source: PluginSourceInput }[] = []
  const rejected: RejectedSource[] = []
  const claimed = new Set<string>()

  for (const source of incoming) {
    const origin = typeof source.origin === 'string' ? source.origin : ''
    if (!PLUGIN_ORIGIN_TOKEN.test(origin)) {
      rejected.push({ origin: origin || '(none)', reason: 'origin must be a short lowercase token' })
      continue
    }
    if (claimed.has(origin)) {
      rejected.push({ origin, reason: `declared twice by '${pluginUri}'` })
      continue
    }
    claimed.add(origin)
    sources.push({
      source,
      meta: {
        origin,
        originUrl: typeof source.originUrl === 'string' ? source.originUrl : '',
        name: typeof source.name === 'string' && source.name ? source.name.slice(0, 64) : origin,
        icon: typeof source.icon === 'string' ? source.icon : null,
        color: typeof source.color === 'string' ? source.color : null,
        isApiOnly: source.isApiOnly === true,
        metadataOnly: source.metadataOnly === true,
        access: source.access === 'account' || source.access === 'paid' ? source.access : 'none',
      },
    })
  }

  return { sources, rejected }
}

/** How long a source has to answer `account`. The connection has no time limit of its own, and Play waits for the answer. */
export const ACCOUNT_WAIT_MS = 3_000

const ACCOUNT_STATES: readonly unknown[] = ['signed-in', 'signed-out', 'no-plan'] satisfies SourceAccount[]

/** A source's `account` answer, or undefined for one that is late, rejected or of any other value. */
export const askAccount = (account: () => Promise<unknown>): Promise<SourceAccount | undefined> =>
  Promise.race([
    Promise.resolve().then(account).then(state => ACCOUNT_STATES.includes(state) ? state as SourceAccount : undefined, () => undefined),
    new Promise<undefined>(resolve => setTimeout(resolve, ACCOUNT_WAIT_MS)),
  ])

/** How long a plugin has to take its values. The connection has no time limit of its own, and its sources wait for this. */
export const CONFIGURE_WAIT_MS = 3_000

/**
 * Hands a plugin its values, settling within CONFIGURE_WAIT_MS. What a plugin rejects with is dropped unread, since it
 * may quote a value and a caller could log it.
 */
export const handValues = (configure: (values: PluginValues) => Promise<unknown>, values: PluginValues): Promise<unknown> =>
  Promise.race([
    Promise.resolve().then(() => configure(values)).catch(() => {}),
    new Promise(resolve => setTimeout(resolve, CONFIGURE_WAIT_MS)),
  ])

type PluginEdge = { node: unknown, relation: string }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const FIELD_KINDS: readonly unknown[] = ['text', 'url', 'secret'] satisfies PluginSettingKind[]

/** The fields a connection lists. As with a source, a malformed or repeated one costs only itself. */
export const readPluginSettings = (settings: unknown): PluginSettingField[] => {
  if (!Array.isArray(settings)) return []
  const claimed = new Set<string>()
  return settings.flatMap((field: unknown) => {
    if (!isObject(field) || typeof field.key !== 'string' || !field.key || typeof field.label !== 'string' || !field.label) return []
    // `in {}`: a value read back by a key like `constructor` would be Object's own member, not what was entered
    if (!FIELD_KINDS.includes(field.kind) || claimed.has(field.key) || field.key in {}) return []
    claimed.add(field.key)
    return [{ key: field.key, label: field.label.slice(0, 64), kind: field.kind as PluginSettingKind, required: field.required === true }]
  })
}

// a bare row names a media by uri, or by origin and id; the uri is derived when only the pair is there
const asRow = (value: unknown): Record<string, unknown> | undefined => {
  if (!isObject(value)) return undefined
  if (typeof value.uri === 'string') return value
  if (typeof value.origin === 'string' && typeof value.id === 'string') return { ...value, uri: `${value.origin}:${value.id}` }
  return undefined
}

const readHandle = (handle: unknown, depth: number): PluginEdge | undefined => {
  if (isObject(handle) && 'node' in handle) {
    if (!isObject(handle.node)) return undefined
    return { ...handle, node: readPluginHandles(handle.node, depth), relation: typeof handle.relation === 'string' ? handle.relation : 'SAME_AS' }
  }
  const row = asRow(handle)
  return row ? { node: readPluginHandles(row, depth), relation: 'SAME_AS' } : undefined
}

const readHandles = (handles: unknown, depth: number): PluginEdge[] =>
  Array.isArray(handles) && depth > 0
    ? handles.map(handle => readHandle(handle, depth - 1)).filter((edge): edge is PluginEdge => edge !== undefined)
    : []

/**
 * A plugin's media with its handles in the shape the store reads.
 *
 * `stub-source@1` plugins were written against `handles: [Media!]!`, a bare list of the rows a media is
 * the same as, and every one of them still sends it: the nyaa package restates the cluster's handles as
 * bare rows. The schema made a handle an edge, `{ node, relation }`, on 2026-09-04 and the worker read
 * `handle.node` from then on, so a bare row was an edge with no node, the unwrap dereferenced it, and
 * the shared insert batch rejected for every extractor in it, first-party sources included
 * (2026-09-05, on the deployed site). A bare row reads as the SAME_AS it always meant; an edge passes
 * through with its node read the same way; anything that is neither is dropped. Episodes' handles are
 * read alike. The depth cap bounds a self-referencing payload.
 */
export const readPluginHandles = <T>(media: T, depth = 4): T => {
  if (!isObject(media)) return media
  const episodes = Array.isArray(media.episodes)
    ? media.episodes.map(episode => isObject(episode) ? { ...episode, handles: readHandles(episode.handles, 1) } : episode)
    : media.episodes
  return { ...media, handles: readHandles(media.handles, depth), episodes } as T
}

/** One plugin payload (`media`, `similarMedia`, `containingMedia` or `mediaPage`) with every media it carries read by `readPluginHandles`. */
export const readPluginPayload = (field: 'media' | 'mediaPage' | 'similarMedia' | 'containingMedia', payload: any): any => {
  if (!isObject(payload)) return payload
  if (field === 'mediaPage') {
    const nodes = (payload.mediaPage as { nodes?: unknown } | undefined)?.nodes
    return Array.isArray(nodes)
      ? { ...payload, mediaPage: { ...(payload.mediaPage as object), nodes: nodes.map(node => readPluginHandles(node)) } }
      : payload
  }
  return payload[field] ? { ...payload, [field]: readPluginHandles(payload[field]) } : payload
}
