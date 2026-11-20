import { networkOf } from '@fkn/package-manifest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getDomain } from 'tldts'
import { expect, test } from 'vite-plus/test'

import { primeSignInUrl, primeSiteFor } from '../../src/sources/amazon/session'
import { ANILIST_LOGIN_URL, ANILIST_SESSION_URL } from '../../src/sources/anilist/session'
import { builtInSources, drawnAs } from '../../src/sources/built-in'
import { CRUNCHYROLL_LOGIN_URL, CRUNCHYROLL_SESSION_URL } from '../../src/sources/crunchyroll/session'
import { serviceLogo } from '../../src/sources/justwatch/logos'
import { MAL_LOGIN_URL, MAL_SESSION_URL } from '../../src/sources/mal/session'
import { DIRECT_FETCH_ORIGINS } from '../../src/worker/direct-fetch'

// HOR-1183: inside fkn.app stub reaches only the sites its fkn.network names, read here as fkn-sign reads it before
// signing a release
const { fkn } = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8'))
const network = networkOf(fkn, name => getDomain(name, { allowPrivateDomains: true }) === null)
const hostOf = (url: string) => new URL(url).hostname

// the owner's answer of 2026-11-20: FKN's package searches and lookups on npm stay outside the rule
test('every entry is a site fkn-sign accepts and keeps, none an FKN page and neither of npm\'s', () => {
  expect(network.problems).toEqual([])
  expect(network.frames).toEqual([])
  expect(network.hosts).toEqual(fkn.network)
  expect(network.hosts).not.toContain('registry.npmjs.org')
  expect(network.hosts).not.toContain('unpkg.com')
})

test('names every host stub asks from the browser, every source icon it draws and every sign-in page it opens', () => {
  const needed = [
    ...[...DIRECT_FETCH_ORIGINS].map(hostOf),
    ...builtInSources.flatMap(({ origin, icon }) => icon && drawnAs(origin) ? [hostOf(icon)] : []),
    hostOf(serviceLogo('nf')!),
    ...[ANILIST_LOGIN_URL, ANILIST_SESSION_URL, CRUNCHYROLL_LOGIN_URL, CRUNCHYROLL_SESSION_URL, MAL_LOGIN_URL, MAL_SESSION_URL].map(hostOf),
    ...['US', 'GB', 'DE', 'JP', 'FR'].map(country => hostOf(primeSignInUrl(primeSiteFor(country)))),
  ]
  expect(needed.filter(host => !network.hosts.includes(host))).toEqual([])
})
