/**
 * Does a provider offer with no source of its own reach a run's page as a LINK and never as an
 * IDENTITY?
 *
 *   node scripts/check-part-of-links.mjs https://anime.fkn.app [query] [providerHost]
 *
 * Defaults to `Spy x Family` and `hulu.com`, chosen because Hulu has no source of its own: the only
 * way a hulu link can reach a page is JustWatch's show-level offer, and since 2026-09-05 that offer is
 * the provider's TITLE as a CONTAINER, carried PART_OF. So on the run's page the header must render
 * the hulu url, and the `ag:(...)` uri the page links to must hold no `hulu:` member: membership of an
 * aggregated uri is SAME_AS by construction, a PART_OF handle rides a directed edge and never appears
 * there. Both halves are read, because either alone proves nothing: a link with a `hulu:` member is
 * the old weld path, and no `hulu:` member with no link is a dropped offer.
 *
 * CONTROLS, each printed, and any failure exits 2 rather than reporting a result:
 *   (a) a LINK whose hostname ends with imdb.com exists on the same page. An imdb id can ONLY render
 *       through the PART_OF path (`SHOW_LEVEL_ORIGINS` in worker/store/db.ts), so its presence proves
 *       the render path this check depends on is alive.
 *   (b) a LINK whose hostname is anilist.co or kitsu.io exists, proving the header rendered its
 *       SAME_AS members at all.
 *   (c) the search returned a cluster to open.
 *   (d) the opened media's own aggregated uri was read off exactly one distinct episode link. Zero
 *       means the modal rendered no episode row so the uri could not be read; two or more means the
 *       rows disagree, which the check cannot interpret.
 * A missing provider link with all four controls green is a real failure (exit 1), and the LINKS list
 * is printed so the providers that did render can be read.
 *
 * ONE PAGE LOAD, client-side navigation exactly as reproduce-season-weld.mjs does: the store lives in
 * the page's worker and a reload wipes it.
 *
 * Headless and muted: it reads the DOM and nothing else. The version line is printed first; a run
 * whose version does not match the pushed sha is discarded, not read.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const ORIGIN = process.argv[2] ?? 'https://anime.fkn.app'
const QUERY = process.argv[3] ?? 'Spy x Family'
const PROVIDER_HOST = process.argv[4] ?? 'hulu.com'
const chrome = process.env.CHROME_PATH ?? execFileSync('which', ['google-chrome-stable'], { encoding: 'utf-8' }).trim()

// the hosts of PACKAGE_ORIGIN_MAP (src/sources/justwatch/id.ts), keyed the way a rendered url reads
const HOST_ORIGIN = {
  'netflix.com': 'nf',
  'hulu.com': 'hulu',
  'disneyplus.com': 'disney',
  'tv.apple.com': 'appletv',
  'crunchyroll.com': 'cr',
  'amazon.com': 'amazon',
  'max.com': 'hbo',
  'peacocktv.com': 'peacock',
  'paramountplus.com': 'paramount',
  'fubo.tv': 'fubo',
  'hidive.com': 'hidive',
  'tubitv.com': 'tubi',
  'therokuchannel.roku.com': 'roku',
  'pluto.tv': 'pluto',
  'watch.plex.tv': 'plex',
  'hoopladigital.com': 'hoopla',
  'starz.com': 'starz',
  'amcplus.com': 'amcplus',
  'philo.com': 'philo',
}
const providerOrigin = HOST_ORIGIN[PROVIDER_HOST]
if (!providerOrigin) {
  console.log(`no origin is known for ${PROVIDER_HOST}; known hosts: ${Object.keys(HOST_ORIGIN).join(', ')}`)
  process.exit(2)
}

const membersOf = ag => ag.replace(/^ag:\(|\)$/g, '').split(',').filter(Boolean)
const hostOf = href => { try { return new URL(href).hostname } catch { return '' } }
const endsWith = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`)

const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })
const page = await browser.newPage()
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)

const version = await page.evaluate(() => document.body.innerText.match(/v[\d.]+ [0-9a-f]{7}/)?.[0] ?? '(none)')
console.log(`${ORIGIN}  ${version}\n`)

const go = async path => {
  await page.evaluate(url => {
    history.pushState({}, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.waitForTimeout(11000)
}
const clustersOnPage = () => page.evaluate(() =>
  [...document.querySelectorAll('a[href*="/media/ag:"]')].map(a => decodeURIComponent(a.getAttribute('href')).replace('/media/', ''))
)

await go('/search/' + encodeURIComponent(QUERY))
const found = [...new Set(await clustersOnPage())]
const target = found.find(ag => membersOf(ag).some(m => m.startsWith('anilist:') || m.startsWith('kitsu:')))
console.log(`search "${QUERY}": ${found.length} clusters, ${target ? 'opening ' + target : 'none holds an anilist or kitsu run'}`)
if (!target) {
  console.log('\nCONTROL (c) FAILED: nothing to open, so nothing was measured')
  await browser.close()
  process.exit(2)
}

await go('/media/' + target)
// the media header's origin row; the Episode rows use the same class names one level deeper, which
// the child combinators exclude
const links = await page.evaluate(() =>
  [...document.querySelectorAll('.modal > .content > .header > .origins > a.origin')].map(a => a.href)
)
// the opened media's own uri: every episode row links /watch/<aggregated media uri>/<episode uri>,
// and nothing else on the page carries it (the /media/ag: cards behind the modal are the home listing)
const openedUris = [...new Set(await page.evaluate(() =>
  [...document.querySelectorAll('.modal .episodes a.episode-link[href^="/watch/"]')]
    .map(a => { const raw = a.getAttribute('href').slice('/watch/'.length).split('/')[0]; try { return decodeURIComponent(raw) } catch { return raw } })
))]
await browser.close()
if (openedUris.length !== 1) {
  console.log(`\nCONTROL (d) FAILED: ${openedUris.length} distinct media uris in the episode links (${openedUris.join(' | ') || 'none'}), so the opened run could not be read`)
  process.exit(2)
}
const cluster = membersOf(openedUris[0])

const hosts = links.map(hostOf)
const controlImdb = hosts.some(host => endsWith(host, 'imdb.com'))
const controlRun = hosts.some(host => host === 'anilist.co' || host === 'kitsu.io')
console.log(`\nLINKS (${links.length}):`)
for (const link of links) console.log(`   ${link}`)
console.log(`CLUSTER (${cluster.length} members): ${cluster.join(', ')}`)
console.log(`\ncontrol (a) imdb link rendered through PART_OF: ${controlImdb ? 'ok' : 'FAILED'}`)
console.log(`control (b) a SAME_AS member (anilist or kitsu) rendered: ${controlRun ? 'ok' : 'FAILED'}`)
console.log('control (c) search returned a cluster: ok')
console.log(`control (d) the opened run's uri read off its episode links: ok (${openedUris[0]})`)
if (!controlImdb || !controlRun) {
  console.log('\nCONTROL FAILED: the header did not render the path this check reads, so the result means nothing')
  process.exit(2)
}

const providerLinked = hosts.some(host => endsWith(host, PROVIDER_HOST))
const providerWelded = cluster.filter(m => m.startsWith(`${providerOrigin}:`))
console.log(`\n${PROVIDER_HOST} link in the header: ${providerLinked ? 'yes' : 'NO'}`)
console.log(`${providerOrigin}: members in the cluster (SAME_AS by construction): ${providerWelded.length ? providerWelded.join(', ') : 'none'}`)

if (providerLinked && !providerWelded.length) {
  console.log('\nPASS: the offer reached the page as a link on an edge, and never as an identity')
  process.exit(0)
}
console.log(providerWelded.length
  ? '\nFAIL: the provider is a SAME_AS member of the run, which is the identity this round moved onto an edge'
  : '\nFAIL: no provider link rendered while every control passed; the offer was dropped rather than carried')
process.exit(1)
