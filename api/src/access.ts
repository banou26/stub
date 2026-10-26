import { fkn } from '../../package.json'

const SITES = new Set(['https://stub.fkn.app', 'https://anime.fkn.app', 'https://movies.fkn.app', 'https://series.fkn.app'])

// fkn-client web/src/sandbox.ts: `<policy digit><base36 of the package address>`, or `<policy digit>0a<app id body>`
// for a release that verified to that app id, which only fkn.app mints. A label is one DNS label, at most 63
// characters (a longer address gets a digest label), and the cap also bounds the decode below, which is quadratic and
// runs before the rate limit: a 100,000 character label took 0.9 s to refuse
const TENANT = /^([0-9a-z])([0-9a-z]{1,62})\.sdbx\.app$/
const APP_LABEL = `0a${fkn.app.slice('fkn:app:'.length)}`
const PACKAGE = /^npm:@banou\/stub(?:@[0-9A-Za-z.+-]+)?$/
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

// base-x's decoding of a body with no leading '0', which is the only kind a package label has
const fromBase36 = (body: string) => {
  let value = 0n
  for (const char of body) value = value * 36n + BigInt(BASE36.indexOf(char))
  const bytes: number[] = []
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 255n))
  return new TextDecoder().decode(new Uint8Array(bytes))
}

const isStubTenant = (hostname: string) => {
  const body = TENANT.exec(hostname)?.[2]
  if (!body) return false
  if (body.startsWith('0')) return body === APP_LABEL
  return PACKAGE.test(fromBase36(body))
}

const isStub = (url: URL) => SITES.has(url.origin) || (url.protocol === 'https:' && !url.port && isStubTenant(url.hostname))

const parse = (value: string | null) => {
  try {
    return value ? new URL(value) : undefined
  } catch {
    return undefined
  }
}

/**
 * The origin a request comes from when it is one of stub's: its four sites, or a `*.sdbx.app` tenant whose label is
 * stub's npm package (any version) or stub's signed app id. Read from `Origin`, else from `Referer` when there is no
 * `Origin`. Never the whole of `*.sdbx.app`, which also serves every other FKN app and the sites mirage shows.
 */
export const stubOrigin = (request: Request): string | undefined => {
  const url = parse(request.headers.get('origin') ?? request.headers.get('referer'))
  return url && isStub(url) ? url.origin : undefined
}
