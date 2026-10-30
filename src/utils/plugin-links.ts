export const PLUGIN_PARAM = 'plugins'

/**
 * What the parameter was called until 2026-09-09, still READ and never written.
 *
 * The link is the whole point of this module: an invite is a url someone pasted into a chat, and it
 * outlives the rename by however long that chat does. Reading both costs one line; not reading the
 * old one turns every shared invite into a page that silently offers nothing.
 */
const LEGACY_PLUGIN_PARAM = 'plugin'

const parse = (url: string, base?: string): URL | undefined => {
  try {
    return new URL(url, base)
  } catch {
    return undefined
  }
}

const dedupe = (uris: string[]): string[] => {
  const seen = new Set<string>()
  return uris.filter(uri => {
    const key = comparablePluginUri(uri)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// FKN canonicalizes a version away on install ('npm:x@1.2.3' registers as 'npm:x')
export const comparablePluginUri = (uri: string): string =>
  uri.trim().replace(/\/+$/, '').replace(/@\d[^@/]*$/, '')

export const readPluginUris = (url: string, base?: string): string[] => {
  const parsed = parse(url, base)
  if (!parsed) return []
  // walked in the order the url writes them, rather than one name's values and then the other's, so a
  // link offering several sources prompts for them in the order it names them
  return dedupe(
    [...parsed.searchParams]
      .filter(([name]) => name === PLUGIN_PARAM || name === LEGACY_PLUGIN_PARAM)
      .map(([, uri]) => uri.trim())
  )
}

/**
 * A path with its source list taken out, every other byte kept. Every address carries the viewer's own
 * sources, so two viewers on the same page compare equal only through this.
 */
export const withoutPluginUris = (path: string): string => {
  const end = path.includes('#') ? path.indexOf('#') : path.length
  const start = path.indexOf('?')
  if (start < 0 || start > end) return path
  const kept = path.slice(start + 1, end).split('&')
    .filter(pair => { const name = pair.split('=', 1)[0]; return name !== PLUGIN_PARAM && name !== LEGACY_PLUGIN_PARAM })
  return `${path.slice(0, start)}${kept.length ? `?${kept.join('&')}` : ''}${path.slice(end)}`
}

// not the URLSearchParams serializer: it percent-encodes ':' '@' '/', which every plugin address is
// made of, and these are legal unencoded in a query
const encodeUri = (uri: string) =>
  encodeURIComponent(uri)
    .replace(/%3A/g, ':')
    .replace(/%2F/g, '/')
    .replace(/%40/g, '@')

export const writePluginUris = (url: string, uris: string[], base: string): string => {
  const parsed = parse(url, base)
  const from = parse(base)
  if (!parsed || !from || parsed.origin !== from.origin) return url
  parsed.searchParams.delete(PLUGIN_PARAM)
  // an url that arrives under the old name leaves under the new one, rather than carrying both
  parsed.searchParams.delete(LEGACY_PLUGIN_PARAM)
  const others = parsed.searchParams.toString()
  const plugins =
    dedupe(uris.map(uri => uri.trim()))
      .sort()
      .map(uri => `${PLUGIN_PARAM}=${encodeUri(uri)}`)
      .join('&')
  parsed.search = [others, plugins].filter(Boolean).join('&')
  return parsed.href
}
