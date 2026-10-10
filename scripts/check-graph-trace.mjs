/**
 * Does a COLD `/debug/trace?uri=...` url answer anything, and does the panel agree with the graph?
 *
 * Three things a unit test cannot reach, because each one lives between a full page load, a real
 * worker and 25 real sources:
 *
 *  - **A pasted link resolves.** The engine is in memory for the life of the worker, and a full load
 *    makes a new one, so every pasted trace url arrives at an empty graph. The page asks the sources
 *    about the uri itself (`src/router/debug/warm.ts`) and traces again as they answer. This arm is
 *    that fix's test: it opens the url the way a bug report reader does and waits for a cluster.
 *    The CONTROL is the same url with no engine flag, which must answer `not-enabled` and must offer
 *    a reload link that carries the flag, since a message advising an action that cannot work is the
 *    defect this replaced.
 *  - **One uri is one box.** `Media.owned` is false for a row no source described, and a pass
 *    clusters such a row whenever one origin fails to answer while others claim it, so a uri can be
 *    both a member and a claimed placeholder. Drawn twice it lands at one position and the meta
 *    lines overstrike, so the last box painted decides whether a reader sees a member. Counted here
 *    on a real cluster, where 50 of 241 clusters carried such a uri on 2026-09-13.
 *  - **An ask that was made is reported.** `Ask.clusterId` is `toAggregatedUri` over the consumer's
 *    own member list, placeholders included, and `Cluster.aggUri` is built from `published`, which
 *    excludes them: the two spellings differ by exactly the placeholder the panel draws. This arm
 *    reads the raw `Ask` log through `__stubExportAsks`, proves the two strings really do differ,
 *    and then asserts the panel drew the row anyway. Nothing about that is visible to a fixture.
 *
 * Run it from inside the repo, against a `vp build` output:
 *   node_modules/.bin/vp build && node scripts/check-graph-trace.mjs
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

import { chromium } from 'playwright'

const ROOT = new URL('../build/', import.meta.url).pathname
// the same work `check-graph-read.mjs` uses: one real show most of the 25 sources can answer about,
// so the cluster has several members and the consumer has containers to ask
const URI = 'ag:(anilist:108465)'
const WARM_MS = Number(process.env.WARM_MS ?? 60_000)

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

const chrome = process.env.CHROME_PATH ?? execFileSync('which', ['google-chrome-stable'], { encoding: 'utf-8' }).trim()
// headless because nothing here watches a transfer, and muted because this is the owner's machine
const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })

/** What the panel is drawing right now, read out of the DOM rather than out of a bundle. */
const readPanel = () => ({
  resolved: document.querySelector('[data-resolved]')?.textContent ?? null,
  clusterId: [...document.querySelectorAll('[data-resolved] .pairs div')]
    .map(pair => pair.textContent ?? '')
    .find(text => text.startsWith('cluster'))?.slice('cluster'.length) ?? null,
  aggUri: [...document.querySelectorAll('[data-resolved] .pairs div')]
    .map(pair => pair.textContent ?? '')
    .find(text => text.startsWith('aggregate'))?.slice('aggregate'.length) ?? null,
  reason: document.querySelector('[data-unresolved]')?.getAttribute('data-reason') ?? null,
  why: document.querySelector('[data-unresolved] .why')?.textContent ?? null,
  reloadHref: document.querySelector('[data-reload-graph]')?.getAttribute('href') ?? null,
  warming: document.querySelector('[data-warming]')?.textContent ?? null,
  counts: document.querySelector('[data-counts]')?.textContent ?? null,
  nodes: [...document.querySelectorAll('[data-node]')].map(node => ({
    uri: node.getAttribute('data-node'),
    kind: node.getAttribute('data-kind'),
  })),
  legend: [...document.querySelectorAll('.legend div')].map(line => line.textContent ?? ''),
  members: [...document.querySelectorAll('[data-node]')].length,
  links: [...document.querySelectorAll('[data-link]')].length,
  refused: [...document.querySelectorAll('[data-link][data-status="refused"]')].length,
  asks: [...document.querySelectorAll('[data-asks] tbody tr')].map(row => row.textContent ?? ''),
  asksEmpty: document.body.textContent?.includes('nothing was asked of any origin') ?? false,
  gaps: [...document.querySelectorAll('.support .unresolved, .proof .missing')].map(node => node.textContent ?? ''),
  slots: [...document.querySelectorAll('[data-slots] tbody tr')].length,
})

const arm = async (label, query, { waitForResolved = false } = {}) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(String(error?.message ?? error)))

  const url = `${origin}/debug/trace?uri=${encodeURIComponent(URI)}${query ? `&${query}` : ''}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-debug-trace]', { timeout: 30_000 })
  const timeline = []
  if (waitForResolved) {
    // A TIMELINE, not one read. The question a cold url has to answer is not only "does it end up
    // populated" but "what does it say while it is not yet", and one sample at the end cannot see a
    // page that sat blank for twenty seconds. Every state change is recorded with the second it
    // happened on, and the loop ends when the fan-out is over rather than on a fixed wait, so the
    // ask rows (which the consumer writes after a run page settles) are included rather than raced.
    const started = Date.now()
    const deadline = started + WARM_MS
    let previous = ''
    while (Date.now() < deadline) {
      const snap = await page.evaluate(() => ({
        state: document.querySelector('[data-resolved]')
          ? 'resolved'
          : document.querySelector('[data-unresolved]')
            ? 'unresolved'
            : document.querySelector('[data-loading]')
              ? 'loading'
              : 'nothing yet',
        reason: document.querySelector('[data-unresolved]')?.getAttribute('data-reason') ?? null,
        warmingKind: document.querySelector('[data-warming]')?.getAttribute('data-warming') ?? null,
        warming: document.querySelector('[data-warming]')?.textContent ?? null,
        nodes: document.querySelectorAll('[data-node]').length,
        links: document.querySelectorAll('[data-link]').length,
        asks: document.querySelectorAll('[data-asks] tbody tr').length,
        slots: document.querySelectorAll('[data-slots] tbody tr').length,
      }))
      const signature = `${snap.state}|${snap.reason}|${snap.warmingKind}|${snap.nodes}|${snap.links}|${snap.asks}`
      if (signature !== previous) {
        timeline.push({ second: Math.round((Date.now() - started) / 100) / 10, ...snap })
        previous = signature
      }
      if (snap.state === 'resolved' && snap.warmingKind === 'done') break
      await new Promise(resolve => setTimeout(resolve, 700))
    }
  } else {
    await page.waitForSelector('[data-unresolved], [data-resolved]', { timeout: 30_000 }).catch(() => {})
  }
  const panel = await page.evaluate(readPanel)
  const asks = await page.evaluate(async () => {
    if (typeof window.__stubExportAsks !== 'function') return 'no export flag'
    try {
      return await window.__stubExportAsks()
    } catch (error) {
      return String(error?.message ?? error)
    }
  })
  const dashes = await page.evaluate(() => (document.body.innerText.match(/[\u2013\u2014]/g) ?? []).length)
  await context.close()
  return { label, url, panel, asks, dashes, errors, timeline }
}

/**
 * THE WAY A PERSON GETS HERE: open a media view, click the link, land on a populated panel.
 *
 * Section 7.5 puts this panel behind `?trace=1` on the modal, and until 2026-09-13 nothing in the app
 * linked to the route at all: reaching a populated trace meant `history.pushState` in a devtools
 * console, which is not a way in. So this arm does what a person does, and it asserts the whole hop:
 * the link is on the media view, it carries the uri that view is drawing, the click is a CLIENT-SIDE
 * navigation (so the worker and everything ingested into it survive), and what lands is a cluster.
 *
 * It is also the control for the cold arm above: the two reach the same panel by different routes,
 * so a panel that only works when it warms itself, or only when the graph is already warm, shows up
 * here as one arm passing and the other failing.
 */
const armViaLink = async (label, query) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(String(error?.message ?? error)))

  await page.goto(`${origin}/media/${encodeURIComponent(URI)}?${query}`, { waitUntil: 'domcontentloaded' })
  // the link renders as soon as the modal has a uri to draw, which is before the fan-out settles
  const link = await page
    .waitForSelector('a[data-trace-link]', { timeout: WARM_MS })
    .catch(() => null)
  const linkHref = link ? await link.getAttribute('href') : null
  const linkUri = link ? await link.getAttribute('data-trace-link') : null
  // wait for the media view's own fan-out to have produced a cluster before the hop, since the point
  // of a client-side navigation is that it keeps what this page ingested
  const counts = await page
    .waitForFunction(() => window.__stubGraphCounts().then(rows => ((rows?.Cluster ?? 0) > 0 ? rows : false)),
      null, { timeout: WARM_MS, polling: 1_000 })
    .then(handle => handle.jsonValue())
    .catch(() => null)

  let navigated = false
  if (link) {
    // a real click, and a real one has to be scrolled into view and not covered: the modal locks the
    // body and the app header is fixed, so a click by coordinate is exactly the thing that lies here
    await link.scrollIntoViewIfNeeded().catch(() => {})
    await link.click({ timeout: 10_000 }).catch(error => errors.push(`the click failed: ${error.message}`))
    navigated = await page
      .waitForSelector('[data-debug-trace]', { timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    await page.waitForSelector('[data-resolved], [data-unresolved]', { timeout: 30_000 }).catch(() => {})
  }
  const reloads = await page.evaluate(() => performance.getEntriesByType('navigation').length)
  const panel = navigated ? await page.evaluate(readPanel) : null
  const asks = await page.evaluate(async () => {
    if (typeof window.__stubExportAsks !== 'function') return 'no export flag'
    try {
      return await window.__stubExportAsks()
    } catch (error) {
      return String(error?.message ?? error)
    }
  })
  const dashes = await page.evaluate(() => (document.body.innerText.match(/[\u2013\u2014]/g) ?? []).length)
  await context.close()
  return { label, url: 'clicked from the media view', panel, asks, dashes, errors, counts, linkHref, linkUri, navigated, reloads }
}

const failures = []
const say = (line) => console.log(line)

// ---------------------------------------------------------------------------------------------
// FINDING 3: the cold url, which is the only kind a bug report ever carries.
const cold = await arm('cold, engine on', 'graph=1&export=answers', { waitForResolved: true })
say(`\n[${cold.label}] ${cold.url}`)
for (const step of cold.timeline) {
  say(`  ${String(step.second).padStart(5)}s  ${step.state}${step.reason ? ` (${step.reason})` : ''}`
    + `  ${step.nodes} node(s) ${step.links} link(s) ${step.slots} slot(s) ${step.asks} ask(s)`
    + `  warm: ${step.warmingKind ?? 'not started'}`)
}
say(`  warming: ${cold.panel.warming}`)
say(`  resolved: ${cold.panel.clusterId ?? 'NOTHING'}  aggUri ${cold.panel.aggUri ?? 'none'}`)
say(`  reason: ${cold.panel.reason ?? 'none'}`)
say(`  counts: ${(cold.panel.counts ?? '').slice(0, 160)}`)
say(`  ${cold.panel.nodes.length} node(s), ${cold.panel.links} link(s) (${cold.panel.refused} refused), ${cold.panel.slots} slot(s)`)
if (!cold.panel.clusterId) failures.push('a cold url with the engine on never resolved a cluster')
if (cold.panel.reason) failures.push(`a cold url answered ${cold.panel.reason} even after warming`)

// THE SAME PANEL REACHED THE OLD WAY, which is the arm that still works when the warm does not:
// it is the one that can show an ask or a duplicated node on a graph someone else filled.
const warmed = await armViaLink('clicked from a media view', 'graph=1&trace=1&export=answers')
say(`\n[${warmed.label}]`)
say(`  the link on the media view: ${warmed.linkHref ?? 'NONE'}`)
say(`  it names: ${warmed.linkUri ?? 'nothing'}`)
say(`  the media view's own ingest before the hop: Cluster ${warmed.counts?.Cluster ?? 0}, Media ${warmed.counts?.Media ?? 0}, Ask ${warmed.counts?.Ask ?? 0}`)
say(`  navigations in this tab: ${warmed.reloads} (1 = the click was client-side, nothing reloaded)`)
say(`  resolved: ${warmed.panel?.clusterId ?? 'NOTHING'}  reason ${warmed.panel?.reason ?? 'none'}`)
say(`  ${warmed.panel?.nodes.length ?? 0} node(s), ${warmed.panel?.links ?? 0} link(s) (${warmed.panel?.refused ?? 0} refused), ${warmed.panel?.slots ?? 0} slot(s)`)
say(`  asks drawn: ${warmed.panel?.asks.length ?? 0}, "nothing was asked" on screen: ${warmed.panel?.asksEmpty}`)
if (!warmed.linkHref) failures.push('no trace link is rendered on a media view carrying ?trace=1')
if (warmed.linkUri && !warmed.linkHref?.includes(encodeURIComponent(warmed.linkUri).slice(0, 8))) {
  say('  (the href spells the uri with its own escaping, which is legal)')
}
if (!warmed.navigated) failures.push('clicking the trace link did not reach the trace page')
if (warmed.reloads > 1) failures.push('the trace link reloaded the tab, which throws the graph away')
if (!warmed.panel?.clusterId) failures.push('the panel reached by clicking the link resolved no cluster')

// the CONTROL for the link: no `?trace=1`, no link. It is debug surface and not product surface.
const unflagged = await browser.newContext()
const plainPage = await unflagged.newPage()
await plainPage.goto(`${origin}/media/${encodeURIComponent(URI)}?graph=1`, { waitUntil: 'domcontentloaded' })
await plainPage.waitForSelector('.modal .title', { timeout: 30_000 }).catch(() => {})
const unflaggedLink = await plainPage.$('a[data-trace-link]')
say(`  the control, same view without ?trace=1: ${unflaggedLink ? 'A LINK IS DRAWN' : 'no link, as intended'}`)
if (unflaggedLink) failures.push('the trace link is drawn without ?trace=1, so it is not behind the flag')
await unflagged.close()

// the control: with no engine flag, the page must refuse AND hand over a link that works
const off = await arm('cold, engine off', 'export=answers')
say(`\n[${off.label}] ${off.url}`)
say(`  reason: ${off.panel.reason}`)
say(`  why: ${off.panel.why}`)
say(`  reload link: ${off.panel.reloadHref}`)
if (off.panel.reason !== 'not-enabled') failures.push(`the control expected not-enabled, got ${off.panel.reason}`)
if (!off.panel.reloadHref?.includes('graph=1')) failures.push('the not-enabled message offers no reload link carrying the engine flag')
if (!off.panel.reloadHref?.includes(encodeURIComponent(URI).replace(/%28/g, '%28'))) {
  say('  (the reload href does not spell the uri the way this check does, which is legal; decoding it)')
}
if (off.panel.warming) failures.push('the page tried to warm a graph whose engine is off')
// and the advice must not point back at the state it describes
if ((off.panel.why ?? '').includes('nothing has been ingested')) {
  failures.push('the not-enabled message still sends the reader to the ingest')
}

// ---------------------------------------------------------------------------------------------
// FINDING 2: one uri, one box, and every kind on screen in the legend.
const richest = ((warmed.panel?.nodes.length ?? 0) >= cold.panel.nodes.length ? warmed : cold)
say(`\n(the two arms below read the ${richest === warmed ? 'media-warmed' : 'self-warmed'} panel, the fuller of the two)`)
const seen = new Map()
for (const node of richest.panel.nodes) seen.set(node.uri, (seen.get(node.uri) ?? 0) + 1)
const twice = [...seen.entries()].filter(([, count]) => count > 1)
say(`[nodes] ${richest.panel.nodes.length} box(es), ${seen.size} distinct uri(s), ${twice.length} drawn twice`)
say(`  kinds: ${[...new Set(richest.panel.nodes.map(node => node.kind))].join(' ')}`)
say(`  legend: ${richest.panel.legend.join(' | ')}`)
if (twice.length) failures.push(`${twice.length} uri(s) drawn twice: ${twice.map(([uri]) => uri).join(' ')}`)
for (const kind of new Set(richest.panel.nodes.map(node => node.kind))) {
  if (!richest.panel.legend.some(line => line.includes(kind))) failures.push(`node kind ${kind} has no legend entry`)
}
if (richest.panel.nodes.length && !richest.panel.legend.length) failures.push('the legend did not render at all')

// ---------------------------------------------------------------------------------------------
// FINDING 1: an ask that was made, reported.
const logged = Array.isArray(richest.asks) ? richest.asks : []
say(`\n[asks] the raw log holds ${Array.isArray(richest.asks) ? logged.length : `nothing readable: ${richest.asks}`} row(s)`)
for (const row of logged.slice(0, 6)) {
  say(`  seq ${row.seq} ${row.origin} ${row.showId} ${row.outcome} (${row.reason}) clusterId ${row.clusterId}`)
}
say(`  the panel drew ${richest.panel.asks.length} row(s): ${richest.panel.asks.join(' ; ').slice(0, 240)}`)
const uriSetOf = (address) => {
  const inner = /^ag:\((.*)\)$/.exec(address ?? '')?.[1]
  return new Set((inner ?? address ?? '').split(',').filter(Boolean))
}
const drawnUris = new Set(richest.panel.nodes.map(node => node.uri))
const owed = logged.filter(row => [...uriSetOf(row.clusterId)].some(uri => drawnUris.has(uri)))
say(`  ${owed.length} of those rows name a uri this cluster draws`)
if (owed.length) {
  const differs = owed.some(row => row.clusterId !== richest.panel.aggUri)
  say(`  the ask address differs from the cluster's aggregate: ${differs}`)
  if (!differs) say('  (they happen to match here, so this arm is weaker than the measured case)')
  if (richest.panel.asksEmpty) failures.push('the panel says nothing was asked while the log holds asks for this cluster')
  if (richest.panel.asks.length < owed.length) {
    failures.push(`the panel drew ${richest.panel.asks.length} ask(s) where ${owed.length} name this cluster`)
  }
} else {
  say('  no ask in this session names this cluster, so this arm proved nothing: re-run it')
}

// ---------------------------------------------------------------------------------------------
// FINDING 4 and 5: what the descent could not resolve.
say(`\n[gaps] ${richest.panel.gaps.length} unresolved support marker(s) on the page`)
for (const gap of [...new Set(richest.panel.gaps)].slice(0, 6)) say(`  ${gap}`)
say(`[dashes] ${cold.dashes} en or em dash(es) in the rendered text`)
if (cold.dashes) failures.push('the page rendered an en or em dash')
if (cold.errors.length) say(`[console] ${cold.errors.slice(0, 4).join(' | ')}`)

await browser.close()
server.close()

say('')
if (failures.length) {
  for (const failure of failures) say(`FAIL: ${failure}`)
  process.exit(1)
}
say('ok: a cold trace url warms itself and resolves, one uri is one box, and an ask that was made is drawn')
