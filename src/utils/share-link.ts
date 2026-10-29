// Share links packed around stub's own address grammar, losslessly. No imports: the app and the link preview Function
// share it.

/** Where a short link opens: `/s/<code>`. */
export const SHORT_PATH = '/s/'

// APPEND ONLY, all four. A code names a row by its index, so a row moved or removed reads every link already shared as
// another address; tests/unit/utils/share-link.test.ts pins the exact code of a link using them.
const ROUTES = ['title', 'media', 'watch']
const ORIGINS = [
  '', 'anilist', 'anizip', 'cr', 'jw', 'kitsu', 'mal', 'nf', 'nyaa', 'offline', 'simkl', 'amazon', 'disney', 'tvmaze',
  'animethemes', 'ann', 'livechart', 'hoopla', 'plex', 'tubi', 'omdb', 'watchmode', 'imdb', 'tmdb', 'tvdb', 'trakt',
  'fubo', 'anidb', 'appletv', 'hbo', 'hulu', 'hidive', 'paramount', 'peacock', 'philo', 'pluto', 'roku', 'starz',
  'amcplus', 'unogs', 'yt', 'jikan', 'stub',
]
const PLUGINS = ['', 'https:stub.plugins.banou.dev']
const UUID_PREFIXES = ['', 'amzn1.dv.gti.']

// the fewest and most segments each route's addresses have (src/router/path.ts)
const SEGMENTS = [[1, 1], [1, 2], [2, 3]] as const
// the longest real link is 695 characters; a decoder without a cap turned a 15 character code into 134 million
const MAX_PATH = 8_192
const MAX_CODE = 16_384

const AGGREGATED = /^ag:\((.*)\)$/
const NUMBER = /^(?:0|[1-9]\d{0,14})$/
const UUID = /^(.*?)([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/
const HEX24 = /^[0-9a-f]{24}$/
// digit runs as numbers, with their length so leading zeros survive; shorter runs cost less as text
const DIGIT_RUN = /(\d{4,15})/

const encoder = new TextEncoder()
const REFUSED = new Error('not a share code')

// arithmetic rather than bit shifts: ids pass 2^31
const writeVar = (out: number[], value: number) => {
  do {
    const low = value % 128
    value = Math.floor(value / 128)
    out.push(value ? low + 128 : low)
  } while (value)
}

const writeText = (out: number[], text: string) => {
  const bytes = encoder.encode(text)
  writeVar(out, bytes.length)
  out.push(...bytes)
}

const writeTokens = (out: number[], text: string) => {
  const parts = text.split(DIGIT_RUN).filter(Boolean)
  writeVar(out, parts.length)
  for (const part of parts) {
    if (/^\d+$/.test(part) && part.length >= 4) {
      writeVar(out, part.length * 2 + 1)
      writeVar(out, Number(part))
    } else {
      const bytes = encoder.encode(part)
      writeVar(out, bytes.length * 2)
      out.push(...bytes)
    }
  }
}

const hexBytes = (hex: string) => hex.match(/../g)!.map(pair => parseInt(pair, 16))

// the id's kind rides in the low 2 bits of its first varint: 0 a number, 1 an earlier id or `<origin>-<id>` and what
// follows it, 2 hex (a uuid behind a known prefix, or Plex's 24), 3 text
const writeId = (out: number[], id: string, seen: string[]) => {
  if (NUMBER.test(id)) return writeVar(out, Number(id) * 4)
  let best = -1
  seen.forEach((earlier, index) => {
    if (earlier.length >= 3 && id.startsWith(earlier) && (best < 0 || earlier.length > seen[best]!.length)) best = index
  })
  if (best >= 0) {
    writeVar(out, best * 4 + 1)
    return writeTokens(out, id.slice(seen[best]!.length))
  }
  const uuid = UUID.exec(id)
  const prefix = uuid ? UUID_PREFIXES.indexOf(uuid[1]!) : -1
  if (uuid && prefix >= 0) {
    writeVar(out, prefix * 2 * 4 + 2)
    return out.push(...hexBytes(uuid.slice(2).join('')))
  }
  if (HEX24.test(id)) {
    writeVar(out, 1 * 4 + 2)
    return out.push(...hexBytes(id))
  }
  writeVar(out, 3)
  writeTokens(out, id)
}

const writeSegment = (out: number[], segment: string, seen: string[]) => {
  const inner = AGGREGATED.exec(segment)?.[1]
  const groups: { origin: string, ids: string[] }[] = []
  for (const handle of inner === undefined ? [segment] : inner.split(',')) {
    const colon = handle.indexOf(':')
    if (colon < 0) throw REFUSED
    const origin = handle.slice(0, colon)
    const id = handle.slice(colon + 1)
    const last = groups.at(-1)
    if (last?.origin === origin) last.ids.push(id)
    else groups.push({ origin, ids: [id] })
  }
  writeVar(out, groups.length * 2 + (inner === undefined ? 0 : 1))
  for (const { origin, ids } of groups) {
    const index = ORIGINS.indexOf(origin)
    const known = index > 0 && index < 64 ? index : 0
    const ascending = ids.length > 1 && ids.every((id, at) => NUMBER.test(id) && (at === 0 || Number(id) > Number(ids[at - 1])))
    // one byte: the origin's row in 6 bits, several ids, ids all ascending numbers written as steps
    out.push(known + (ids.length > 1 ? 64 : 0) + (ascending ? 128 : 0))
    if (!known) writeText(out, origin)
    if (ids.length > 1) writeVar(out, ids.length - 2)
    let previous = 0
    for (const id of ids) {
      if (ascending) {
        writeVar(out, Number(id) - previous)
        previous = Number(id)
      } else writeId(out, id, seen)
      seen.push(id, `${origin}-${id}`)
    }
  }
}

const pack = (pathAndQuery: string): Uint8Array => {
  const mark = pathAndQuery.indexOf('?')
  const path = mark < 0 ? pathAndQuery : pathAndQuery.slice(0, mark)
  const query = mark < 0 ? undefined : pathAndQuery.slice(mark + 1)
  const [empty, routeName, ...segments] = path.split('/')
  const route = ROUTES.indexOf(routeName!)
  if (empty !== '' || route < 0 || segments.length < SEGMENTS[route]![0] || segments.length > SEGMENTS[route]![1] || segments.includes('')) throw REFUSED
  const out = [route * 4 + segments.length]
  const seen: string[] = []
  for (const segment of segments) writeSegment(out, segment, seen)
  for (const part of query === undefined ? [] : query.split('&')) {
    if (!part.startsWith('plugins=')) throw REFUSED
    const plugin = part.slice('plugins='.length)
    const index = Math.max(0, PLUGINS.indexOf(plugin))
    writeVar(out, index)
    if (!index) writeText(out, plugin)
  }
  return Uint8Array.from(out)
}

const unpack = (bytes: Uint8Array): string => {
  let at = 0
  let size = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const left = () => bytes.length - at
  const byte = () => {
    if (at >= bytes.length) throw REFUSED
    return bytes[at++]!
  }
  const count = (value: number) => {
    if (value > left()) throw REFUSED
    return value
  }
  const varint = () => {
    let value = 0
    for (let scale = 1, read = 0; ; scale *= 128, read++) {
      if (read === 8) throw REFUSED
      const next = byte()
      value += (next % 128) * scale
      if (next < 128) break
    }
    if (value > Number.MAX_SAFE_INTEGER) throw REFUSED
    return value
  }
  const take = (length: number) => bytes.subarray(at, at += count(length))
  const text = () => decoder.decode(take(varint()))
  const spend = (part: string) => {
    size += part.length + 1
    if (size > MAX_PATH) throw REFUSED
    return part
  }
  const tokens = () => {
    let out = ''
    for (let remaining = count(varint()); remaining > 0; remaining--) {
      const head = varint()
      if (head % 2) {
        const digits = (head - 1) / 2
        const value = String(varint())
        if (digits > 15 || value.length > digits) throw REFUSED
        out += value.padStart(digits, '0')
      } else out += decoder.decode(take(head / 2))
    }
    return out
  }
  const hex = (length: number) => Array.from(take(length), value => value.toString(16).padStart(2, '0')).join('')
  const id = (seen: string[]) => {
    const head = varint()
    const kind = head % 4
    const payload = (head - kind) / 4
    if (kind === 0) return String(payload)
    if (kind === 1) {
      if (payload >= seen.length) throw REFUSED
      return seen[payload]! + tokens()
    }
    if (kind === 3) return tokens()
    if (payload === 1) return hex(12)
    const prefix = UUID_PREFIXES[payload / 2]
    if (prefix === undefined) throw REFUSED
    const value = hex(16)
    return `${prefix}${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
  }

  const head = byte()
  const route = Math.floor(head / 4)
  const segmentCount = head % 4
  const bounds = SEGMENTS[route]
  if (!bounds || segmentCount < bounds[0] || segmentCount > bounds[1]) throw REFUSED
  const segments: string[] = []
  const seen: string[] = []
  for (let segment = 0; segment < segmentCount; segment++) {
    const header = varint()
    const aggregated = header % 2 === 1
    const groups = count((header - (aggregated ? 1 : 0)) / 2)
    if (!groups || (!aggregated && groups !== 1)) throw REFUSED
    const handles: string[] = []
    for (let group = 0; group < groups; group++) {
      const flags = byte()
      const index = flags % 64
      const origin = index ? ORIGINS[index] : text()
      if (origin === undefined) throw REFUSED
      const several = Boolean(flags & 64)
      const ascending = Boolean(flags & 128)
      const ids = several ? count(varint() + 2) : 1
      if ((ascending && !several) || (!aggregated && several)) throw REFUSED
      let previous = 0
      for (let at = 0; at < ids; at++) {
        const value = ascending ? String(previous += varint()) : id(seen)
        if (previous > Number.MAX_SAFE_INTEGER) throw REFUSED
        seen.push(value, `${origin}-${value}`)
        handles.push(spend(`${origin}:${value}`))
      }
    }
    segments.push(aggregated ? `ag:(${handles.join(',')})` : handles[0]!)
  }
  const plugins: string[] = []
  while (left()) {
    const index = varint()
    const plugin = index ? PLUGINS[index] : text()
    if (plugin === undefined) throw REFUSED
    plugins.push(spend(`plugins=${plugin}`))
  }
  return `/${[ROUTES[route], ...segments].join('/')}${plugins.length ? `?${plugins.join('&')}` : ''}`
}

const toCode = (bytes: Uint8Array) => {
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromCode = (code: string) => {
  if (code.length > MAX_CODE || !/^[\w-]+$/.test(code)) throw REFUSED
  return Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0))
}

/**
 * The address `/title/`, `/media/` or `/watch/` `pathAndQuery` names, packed into a code for `/s/<code>`, or undefined
 * when stub's grammar cannot write it: another route, a query carrying anything but `plugins=`, a fragment, or a code
 * that would not read back as exactly this address.
 */
export const shortenPath = (pathAndQuery: string): string | undefined => {
  if (pathAndQuery.length > MAX_PATH || pathAndQuery.includes('#')) return undefined
  try {
    const code = toCode(pack(pathAndQuery))
    return expandPath(code) === pathAndQuery ? code : undefined
  } catch {
    return undefined
  }
}

/** The address a code from `shortenPath` packs, or undefined for anything else. Never throws, and never reads past its limits. */
export const expandPath = (code: string): string | undefined => {
  try {
    return unpack(fromCode(code))
  } catch {
    return undefined
  }
}
