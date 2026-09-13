/**
 * Does `?store=graph` ANSWER a real page, and does it answer the same page the old store answers?
 *
 * Two arms over one build, the second the control for the first. Both load a real media route with
 * real sources; one carries `?store=graph` and one does not. Each then puts the CLIENT'S OWN
 * documents through `window.__stubGraphQL`, which calls the same `handleRequest` urql's fetch
 * exchange calls, so the payload comes back through the real yoga, the real resolvers and whichever
 * read store the page's flags selected. A probe that rebuilt the read could not tell the two stores
 * apart, and reading the DOM would be measuring the renderer.
 *
 * WHAT MAKES THIS A CHECK AND NOT A SMOKE TEST. Three things are asserted that can each fail on
 * their own, and each has a control:
 *
 *  - The graph arm answers at all. An empty page is the failure the unit suite cannot see, because
 *    every test there seeds its own graph and never waits on 24 sources.
 *  - The graph arm is SERVED BY THE GRAPH. A cluster's `_id` is its `Cluster.id` and starts with
 *    `cl:`, and its `origin` is the literal `ag` (`src/worker/graph/plugins/fields.ts`), neither of
 *    which the old store ever produces. The legacy arm is the control: if it also comes back `cl:`
 *    then the marker means nothing and the run reports that rather than a pass.
 *  - The FIRST payload is already the graph's. `setReadStore` does not return until the engine has
 *    opened and the boot pass has run, about a second, and a subscription resolves its store once at
 *    subscribe time and keeps it for life, so a flag handed over without `await` leaves the first
 *    subscriptions on the old store forever (fixed in `src/worker.ts`, 2026-09-12). No unit test can
 *    reach that: it lives in the page entry, between a worker boot and a first render. This arm is
 *    that fix's test, which is why it reports the payload INDEX at which the graph first answered.
 *
 * Run it from inside the repo, against a `vp build` output:
 *   node_modules/.bin/vp build && node scripts/check-graph-read.mjs
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

import { chromium } from 'playwright'

const ROOT = new URL('../build/', import.meta.url).pathname
// Mushoku Tensei season 1, the same uri the engine check uses: one real work most of the 24 sources
// can answer about, so the fan-out is a real one and the cluster has more than one member.
const URI = 'ag:(anilist:108465)'
const ROUTE = `/media/${URI}`
// how long each arm collects payloads before it reports what the page SETTLED on. Overridable
// because the two stores converge at different speeds and telling "slower" from "never" is the
// whole question when a member is missing: SETTLE_MS=60000 node scripts/check-graph-read.mjs
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 25_000)

const TYPES = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}

const fileFor = (pathname) => {
  const candidate = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
  try {
    if (statSync(candidate).isFile()) return candidate
  } catch {}
  return extname(pathname) ? undefined : join(ROOT, 'index.html')
}

const server = createServer((request, response) => {
  const file = fileFor(new URL(request.url, 'http://localhost').pathname)
  if (!file) {
    response.writeHead(404).end()
    return
  }
  response.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
  createReadStream(file).pipe(response)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

// The documents come out of the CLIENT, never retyped, for the reason the unit suite gives: a check
// against a copy of a document the app has since changed proves nothing about the app.
const sourceOf = (file) => readFileSync(new URL(file, import.meta.url).pathname, 'utf-8')
const documentNamed = (file, name) => {
  const block = [...sourceOf(file).matchAll(/gql\(`([\s\S]*?)`\)/g)]
    .map(match => match[1])
    .find(entry => entry.includes(`subscription ${name}(`) || entry.includes(`fragment ${name} on`))
  if (!block) throw new Error(`no document named ${name} in ${file}: the client renamed it`)
  return block
}

const MEDIA_FRAGMENT = documentNamed('../src/worker/resolvers/media/fragment.ts', 'MediaFragment')
const EPISODE_FRAGMENT = documentNamed('../src/worker/resolvers/episode/fragment.ts', 'EpisodeFragment')
const MEDIA_MODAL = documentNamed('../src/router/home/media-modal.tsx', 'GetMediaModal')
const HOME_PAGE = documentNamed('../src/router/home/index.tsx', 'GetReleasingMediaPage')
const MODAL_DOCUMENT = [MEDIA_MODAL, MEDIA_FRAGMENT, EPISODE_FRAGMENT].join('\n')
const PAGE_DOCUMENT = [HOME_PAGE, MEDIA_FRAGMENT].join('\n')

// the season the home row asks for, by `animeSeasonOf`'s own rule (`src/sources/season.ts:26-29`,
// three months per season from January), so this check follows the clock the way the page does
// rather than pinning a season that goes stale in December
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
const now = new Date()
const SEASON = SEASONS[Math.floor(now.getMonth() / 3)]
const SEASON_YEAR = now.getFullYear()

const chrome = process.env.CHROME_PATH ?? execFileSync('which', ['google-chrome-stable'], { encoding: 'utf-8' }).trim()
// headless because nothing here watches a transfer, and muted because this is the owner's machine
const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })

const arm = async (label, query) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(String(error?.message ?? error)))

  const started = Date.now()
  await page.goto(`${origin}${ROUTE}?${query}`, { waitUntil: 'domcontentloaded' })
  const installed = await page
    .waitForFunction(() => typeof window.__stubGraphQL === 'function', null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  const installedMs = Date.now() - started

  if (!installed) {
    await context.close()
    return { label, installed: false, errors, installedMs }
  }

  // the variables the CLIENT passes for each document, not a guess: both carry a non-null input
  // besides the main one, and omitting it fails the document before it reaches a resolver, which
  // looks exactly like a store that answered nothing (walked into on this check's first real run)
  const result = await page.evaluate(async ([modal, pageDoc, uri, settleMs, season, seasonYear]) => {
    try {
      const answer = await window.__stubGraphQL(
        modal,
        { input: { uri }, descriptionInput: { type: 'HTML' } },
        { settleMs }
      )
      const listing = await window.__stubGraphQL(
        pageDoc,
        { input: { season, seasonYear, sorts: ['POPULARITY_DESC'] }, shortDescriptionInput: { count: 1 } },
        { settleMs: Math.min(settleMs, 15_000) }
      )
      return { answer, listing }
    } catch (error) {
      return { failed: String(error?.message ?? error) }
    }
  }, [MODAL_DOCUMENT, PAGE_DOCUMENT, URI, SETTLE_MS, SEASON, SEASON_YEAR])

  await context.close()

  const nodes = result.listing?.last?.data?.mediaPage?.nodes
  const media = result.answer?.last?.data?.media
  return {
    label,
    installed: true,
    installedMs,
    errors,
    failed: result.failed,
    payloads: result.answer?.payloads ?? 0,
    graphqlErrors: result.answer?.last?.errors ?? result.listing?.last?.errors,
    listing: {
      nodes: nodes?.length ?? 0,
      // a card that nulls one non-null field nulls the whole page, so counting cards that ARRIVED
      // with a title is the closed set's real test on live data rather than on a fixture
      titled: (nodes ?? []).filter(node => node?.titles?.[0]?.title).length,
      withHandles: (nodes ?? []).filter(node => (node?.handles?.length ?? 0) > 0).length,
      uris: (nodes ?? []).map(node => String(node?.uri ?? '')),
    },
    media: media && {
      _id: media._id,
      uri: media.uri,
      origin: media.origin,
      title: media.titles?.[0]?.title,
      members: (String(media.uri ?? '').match(/\(([^)]*)\)/)?.[1] ?? '').split(',').filter(Boolean),
      // the handles are what `askUnasked` walks to decide which origins to re-ask (7.1), so a source
      // missing from the page is often a source missing from HERE one step earlier
      handleUris: (media.handles ?? []).map(handle => `${handle.relation}:${handle.node?.uri}`),
      handles: media.handles?.length ?? 0,
      episodes: media.episodes?.length ?? 0,
      episodeCount: media.episodeCount,
    },
  }
}

const graph = await arm('store=graph', 'graph=1&store=graph&export=query')
// `store=legacy` is REQUIRED here since the 2026-09-13 flip. Without it this control arm reads
// the graph too, and the comparison silently becomes graph against graph: a control that agrees
// with its treatment because it IS its treatment.
const legacy = await arm('legacy', 'graph=1&store=legacy&export=query')

await browser.close()
server.close()

const report = (result) => {
  console.log(`\n[${result.label}]`)
  if (!result.installed) {
    console.log(`  window.__stubGraphQL: NEVER INSTALLED after ${result.installedMs} ms`)
  } else {
    console.log(`  installed after ${result.installedMs} ms, ${result.payloads} payload(s)`)
  }
  if (result.failed) console.log(`  probe threw: ${result.failed}`)
  if (result.graphqlErrors) console.log(`  graphql errors: ${JSON.stringify(result.graphqlErrors).slice(0, 400)}`)
  if (result.media) {
    console.log(`  _id ${result.media._id}`)
    console.log(`  uri ${result.media.uri}  origin ${result.media.origin}`)
    console.log(`  title ${JSON.stringify(result.media.title)}`)
    console.log(`  handles ${result.media.handles}  episodes ${result.media.episodes}  episodeCount ${result.media.episodeCount}`)
    console.log(`  members (${result.media.members.length}) ${result.media.members.join(' ')}`)
    console.log(`  handles ${result.media.handleUris.join(' ')}`)
  } else {
    console.log('  media: NULL')
  }
  console.log(`  listing (${SEASON} ${SEASON_YEAR}): ${result.listing?.nodes ?? 0} cards, ${result.listing?.titled ?? 0} titled, ${result.listing?.withHandles ?? 0} with handles`)
  if (result.errors.length) console.log(`  console errors: ${result.errors.slice(0, 5).join(' | ')}`)
}

report(graph)
report(legacy)

const failures = []
// ONLY the cluster id. `origin` is `ag` on BOTH stores (the old store's aggregate carries it too),
// which the control caught on the first real run: a marker the control also carries proves nothing,
// and the run said so rather than passing. A `cl:` `_id` is `Cluster.id` and the old store's is a uuid.
const servedByGraph = (result) => Boolean(result.media?._id?.startsWith('cl:'))

if (!graph.installed) failures.push('the store=graph load never installed window.__stubGraphQL')
if (graph.failed) failures.push(`the store=graph probe threw: ${graph.failed}`)
if (!graph.media) failures.push('the store=graph arm answered a NULL media, which is an empty page')
if (graph.graphqlErrors) failures.push('the store=graph arm returned graphql errors')
// a document both arms reject is a broken PROBE, and saying so is the difference between fixing the
// check and hunting a store bug that does not exist
if (graph.graphqlErrors && legacy.graphqlErrors) failures.push('BOTH arms returned graphql errors, so this is the probe and not the store')
if (graph.media && !graph.media.title) failures.push('the store=graph arm answered a media with no title')

// the control: the marker is only evidence if the arm WITHOUT the flag does not carry it
if (!legacy.media) failures.push('the legacy control answered a NULL media, so the comparison has no baseline')
if (servedByGraph(legacy)) failures.push('the legacy control carries the graph marker, so the marker proves nothing')
if (graph.media && !servedByGraph(graph)) failures.push('the store=graph arm was served by the LEGACY store: the flag did not take')

if (graph.media && legacy.media) {
  if (!graph.media.episodes) failures.push('the store=graph arm listed no episodes where the page has some')
  const ratio = legacy.media.episodes ? graph.media.episodes / legacy.media.episodes : 1
  if (ratio < 0.5) failures.push(`the store=graph arm listed ${graph.media.episodes} episodes against the legacy ${legacy.media.episodes}`)
  if (!graph.media.handles) failures.push('the store=graph arm carries no handles, so the page draws no source badge')
  // the LISTING is the other half of the read path and the first thing a user sees
  if (!graph.listing.nodes) failures.push('the store=graph arm listed no cards at all on the home row')
  if (graph.listing.nodes && graph.listing.titled < graph.listing.nodes) {
    failures.push(`the store=graph arm listed ${graph.listing.nodes} cards of which only ${graph.listing.titled} carry a title`)
  }
  if (legacy.listing.nodes && graph.listing.nodes < legacy.listing.nodes / 2) {
    failures.push(`the store=graph arm listed ${graph.listing.nodes} cards against the legacy ${legacy.listing.nodes}`)
  }
  // membership is the whole point of a cluster, so a member the old store found and the new one did
  // not is reported by NAME rather than as a count: it is the shape every merging bug takes
  // the two stores are EXPECTED to differ here: 6.1's hide rule is store-wide where the old store's
  // `hideAttachedContainers` only hid inside the list it was given, so the graph drawing fewer cards
  // is the rule working. Naming the difference is what tells that apart from cards going missing.
  const graphUris = new Set(graph.listing.uris)
  const onlyLegacy = legacy.listing.uris.filter(uri => !graphUris.has(uri))
  const legacyUris = new Set(legacy.listing.uris)
  const onlyGraph = graph.listing.uris.filter(uri => !legacyUris.has(uri))
  console.log(`\nlisting: ${onlyLegacy.length} card(s) only the legacy store drew, ${onlyGraph.length} only the graph drew`)
  if (onlyLegacy.length) console.log(`  legacy only, first 8: ${onlyLegacy.slice(0, 8).join(' ')}`)
  if (onlyGraph.length) console.log(`  graph only, first 8: ${onlyGraph.slice(0, 8).join(' ')}`)

  const missing = legacy.media.members.filter(member => !graph.media.members.includes(member))
  const extra = graph.media.members.filter(member => !legacy.media.members.includes(member))
  if (missing.length) console.log(`\nmembers the legacy store found and the graph did not: ${missing.join(' ')}`)
  if (extra.length) console.log(`members the graph found and the legacy store did not: ${extra.join(' ')}`)
}

console.log('')
if (failures.length) {
  for (const failure of failures) console.log(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('ok: the graph store answers the media page, and the legacy control disagrees with its marker')
