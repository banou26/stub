/**
 * Does the built app open the graph store by default, leave it alone under `?store=legacy`, and fill
 * the answer log from real sources?
 *
 * Three arms. The second is the control for the first: the default load must open the store, and the
 * opt out must not touch it at all, so a check that only ran the first could not tell "the default
 * works" from "the store opens whatever the url says".
 *
 * BOTH ARMS WERE INVERTED UNTIL 2026-09-14, when `?graph=1` was the switch and its absence was the
 * control, and the flagged arm also had to see a 22 MB engine file fetched over the network. The
 * store is `src/worker/graph/cypher` in the same worker now, so there is no engine file to watch and
 * no request to count: what separates the two arms is the console, and nothing else.
 *
 * The third opens a media page with `?export=answers` and reads the log back through
 * `window.__stubExportAnswers`, and the graph the ingest made of it through `window.__stubGraphCounts`.
 * It is the only arm that talks to the real sources over the network, which is deliberate: the unit
 * suite drives the hook against a fixture server, and what it cannot tell you is whether 24 sources
 * answering at once produce answers the log recognises and rows the ingest can write. It reports the
 * rows, the bytes, the time and the row count of every table, since that is the cost the tee of step
 * 1b has to fit inside. A log that filled while `Media` or `CLAIMS` stayed at zero is a tee that
 * quarantined the page, which is the failure a rows-only arm cannot see.
 *
 * Run it from inside the repo, against a `vp build` output:
 *   node_modules/.bin/vp build && node scripts/check-graph-engine.mjs
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

import { chromium } from 'playwright'

const ROOT = new URL('../build/', import.meta.url).pathname
// Mushoku Tensei season 1, as `getRoutePath(Route.MEDIA, { uri })` spells it (`src/router/path.ts`):
// one real uri that most of the 24 sources can answer about, so the fan-out is a real one.
const ANSWER_URI = 'ag:(anilist:108465)'
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
  // clean URLs: a route with no extension falls back to the app shell, as Pages does
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
const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })

/** Loads the app once in a clean context and records what it said and what it asked the server for. */
const arm = async (query, settleMs) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const logs = []
  page.on('console', message => logs.push(message.text()))

  const started = Date.now()
  await page.goto(`${origin}/${query}`, { waitUntil: 'domcontentloaded' })
  let ready
  for (let waited = 0; waited < settleMs; waited += 250) {
    await page.waitForTimeout(250)
    const line = logs.find(text => text.includes('graph: engine ready'))
    if (line) { ready = { line, at: Date.now() - started }; break }
  }
  if (!ready) await page.waitForTimeout(Math.max(0, settleMs - (Date.now() - started)))
  await context.close()
  return { ready, graphLogs: logs.filter(text => text.startsWith('graph:')) }
}

const failures = []

const on = await arm('', 60000)
console.log(`by default: ${on.ready ? `"${on.ready.line}" after ${on.ready.at} ms` : 'NO graph line in 60s'}`)
if (!on.ready) failures.push('the default load never logged "graph: engine ready"')

// The control waits at least as long as the default arm took, so "nothing happened" is a result and
// not just a shorter wait.
const settle = Math.max(15000, (on.ready?.at ?? 0) * 2)
const off = await arm('?store=legacy', settle)
console.log(`under ?store=legacy, after ${settle} ms: graph lines ${off.graphLogs.length ? JSON.stringify(off.graphLogs) : 'none'}`)
if (off.graphLogs.length) failures.push('the opted out load touched the graph')

/**
 * The third arm: a real media page, the real sources, and the log read back off `window`.
 *
 * The absence of `window.__stubExportAnswers` is what tells the caller the flag never reached the
 * app, so it is waited for separately from the rows: a page that installed nothing and a page whose
 * sources answered nothing are different failures and are reported as such.
 */
const answersArm = async (route, waitMs) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })

  const started = Date.now()
  await page.goto(`${origin}${route}?export=answers`, { waitUntil: 'domcontentloaded' })
  const installed = await page
    .waitForFunction(() => typeof window.__stubExportAnswers === 'function', null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false)

  const read = () => page.evaluate(async () => {
    try {
      const started = performance.now()
      const rows = await window.__stubExportAnswers()
      // the read is a worker round trip plus every row crossing it as a string: the number step 1b's
      // tee has to fit beside, measured rather than assumed
      const ms = Math.round(performance.now() - started)
      // the same flush answers both, so the counts can never describe a log the page has not seen
      const counts = typeof window.__stubGraphCounts === 'function' ? await window.__stubGraphCounts() : undefined
      return { ms, counts, rows: rows.length, bytes: rows.reduce((total, row) => total + row.raw.length, 0), origins: [...new Set(rows.map(row => row.origin))].sort(), kinds: [...new Set(rows.map(row => row.kind))].sort() }
    } catch (error) {
      return { failed: String(error?.message ?? error) }
    }
  })

  let first
  let last = { rows: 0, bytes: 0, origins: [], kinds: [] }
  while (installed && Date.now() - started < waitMs) {
    const outcome = await read()
    // a read that failed is kept only until one succeeds: early in a cold load the worker is still
    // booting, and ending the arm on that would report a failure the next second would not have
    last = { ...last, ...outcome, failed: outcome.failed }
    if (outcome.rows > 0) { first ??= Date.now() - started; break }
    await page.waitForTimeout(1000)
  }
  // the first row says the path works; the rest of the window says what a fan-out costs
  if (first) {
    await page.waitForTimeout(Math.max(0, waitMs - (Date.now() - started)))
    last = { ...last, ...await read() }
  }
  await context.close()
  return { installed, first, ...last, errors }
}

const answers = await answersArm(`/media/${ANSWER_URI}`, 30000)
console.log(`with ?export=answers on /media/${ANSWER_URI}:`)
console.log(`  window.__stubExportAnswers: ${answers.installed ? 'installed' : 'NEVER INSTALLED'}`)
console.log(`  rows ${answers.rows}, ${answers.bytes} bytes of raw, first row after ${answers.first ?? '-'} ms, read back in ${answers.ms ?? '-'} ms`)
if (answers.failed) console.log(`  the page could not read the log: ${answers.failed}`)
console.log(`  kinds: ${answers.kinds.join(', ') || 'none'}`)
console.log(`  origins (${answers.origins.length}): ${answers.origins.join(', ') || 'none'}`)
const counts = answers.counts ?? {}
const filled = Object.entries(counts).filter(([, total]) => total > 0)
console.log(`  tables: ${filled.map(([table, total]) => `${table} ${total}`).join(', ') || 'none'}`)
if (!answers.installed) failures.push('the flagged load never installed window.__stubExportAnswers')
if (answers.failed) failures.push(`window.__stubExportAnswers threw: ${answers.failed}`)
if (answers.installed && !answers.failed && !answers.counts) failures.push('the flagged load never installed window.__stubGraphCounts')
// the ingest is the point of the arm, not the log: a page whose sources answered must produce rows
// and the claims between them, and zero on either is a tee that ran and wrote nothing
if (answers.rows && !(counts.Media > 0)) failures.push(`the log filled but Media is ${counts.Media ?? 'absent'}`)
if (answers.rows && !(counts.CLAIMS > 0)) failures.push(`the log filled but CLAIMS is ${counts.CLAIMS ?? 'absent'}`)
if (answers.installed && !answers.failed && !answers.rows) {
  // this machine could not complete the arm: say so with what the page reported, rather than
  // asserting something weaker that a session with no network would also pass
  failures.push(`no Answer row after 30 s of a real fan-out${answers.errors.length ? `, console errors: ${JSON.stringify(answers.errors.slice(0, 3))}` : ', and the page logged no error'}`)
}

await browser.close()
server.close()

if (failures.length) {
  for (const failure of failures) console.log(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('PASS: the store opens by default and is untouched under ?store=legacy')
