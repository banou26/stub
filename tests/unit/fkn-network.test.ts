import { networkOf } from '@fkn/package-manifest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getDomain } from 'tldts'
import { expect, test } from 'vite-plus/test'

import seasons from '../../src/generated/anime-seasons'
import { primeSignInUrl, primeSiteFor } from '../../src/sources/amazon/session'
import { ANILIST_LOGIN_URL, ANILIST_SESSION_URL } from '../../src/sources/anilist/session'
import { builtInSources } from '../../src/sources/built-in'
import { CRUNCHYROLL_LOGIN_URL, CRUNCHYROLL_SESSION_URL } from '../../src/sources/crunchyroll/session'
import { serviceLogo } from '../../src/sources/justwatch/logos'
import { MAL_LOGIN_URL, MAL_SESSION_URL } from '../../src/sources/mal/session'
import { TRAKT_LOGIN_URL, TRAKT_SESSION_URL } from '../../src/sources/trakt/session'
import { historyEntry, historyMedia, SHARDS } from '../../src/sources/offline/history'
import { loadShard } from '../../src/sources/offline/history-shards'
import { seasonMedia, type ManamiRecord } from '../../src/sources/offline/normalize'
import { DIRECT_FETCH_ORIGINS } from '../../src/worker/direct-fetch'

// HOR-1183: inside fkn.app stub reaches only the sites its fkn.network names, read here as fkn-sign reads it before
// signing a release
const { fkn } = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8'))
const network = networkOf(fkn, name => getDomain(name, { allowPrivateDomains: true }) === null)
const hostOf = (url: string) => new URL(url).hostname
const unlisted = (hosts: Iterable<string>) => [...new Set(hosts)].filter(host => !network.hosts.includes(host))

// the owner's answer of 2026-11-20: FKN's package searches and lookups on npm stay outside the rule
test('every entry is a site fkn-sign accepts and keeps, none an FKN page and neither of npm\'s', () => {
  expect(network.problems).toEqual([])
  expect(network.frames).toEqual([])
  expect(network.hosts).toEqual(fkn.network)
  expect(network.hosts).not.toContain('registry.npmjs.org')
  expect(network.hosts).not.toContain('unpkg.com')
})

// Settings draws every built-in source's icon on anime.fkn.app, which asks them all
test('names every host stub asks from the browser, every source icon it draws and every sign-in page it opens', () => {
  const needed = [
    ...[...DIRECT_FETCH_ORIGINS].map(hostOf),
    ...builtInSources.flatMap(({ icon }) => icon && !icon.startsWith('data:') ? [hostOf(icon)] : []),
    hostOf(serviceLogo('nf')!),
    ...[ANILIST_LOGIN_URL, ANILIST_SESSION_URL, CRUNCHYROLL_LOGIN_URL, CRUNCHYROLL_SESSION_URL, MAL_LOGIN_URL, MAL_SESSION_URL, TRAKT_LOGIN_URL, TRAKT_SESSION_URL].map(hostOf),
    ...['US', 'GB', 'DE', 'JP', 'FR'].map(country => hostOf(primeSignInUrl(primeSiteFor(country)))),
  ]
  expect(unlisted(needed)).toEqual([])
})

// the owner's answer of 2026-11-21: stub-plugin hands stub each source icon as a data url, so the list does not grow
test("names none of stub-plugin's icon hosts", () => {
  const icons = ['eztvx.to', 'knaben.org', 'nyaa.si', 'thepiratebay.org', 'torrentio.strem.fun', 'yts.gg']
  expect(network.hosts.filter(host => icons.includes(host))).toEqual([])
})

// manami takes each picture from whichever source supplied it, so the shipped data names hosts no source asks
test('names every host the offline data built for this release draws a cover or banner from', async () => {
  const media = Object.values((seasons as { seasons: Record<string, ManamiRecord[]> }).seasons).flat().flatMap(record => seasonMedia(record) ?? [])
  for (let shard = 0; shard < SHARDS; shard++) {
    for (const key of Object.keys((await loadShard('dump', shard))?.records ?? {})) {
      const entry = await historyEntry(key, loadShard, false)
      if (entry) media.push(historyMedia(entry, []))
    }
  }
  const images = media.flatMap(({ covers, banners }) => [...covers, ...banners].map(({ url }) => url))
  expect(images.length, 'control: the data has to be built for this to prove anything').toBeGreaterThan(10_000)
  expect(unlisted(images.map(hostOf))).toEqual([])
})
