/**
 * How long does the HOME PAGE take to draw its first card, and what does the store do to get there?
 *
 * The modal was measured first and the home page turned out to be a different workload: a listing,
 * driven by the ingest and the plugin passes rather than by a single cluster read. Measured
 * 2026-09-13, it was 2,107 ms against the legacy store's 504 ms, with 1,046 queries moving 112,040
 * rows to draw 24 cards. Two fixes in `cypher/executor.ts` took that to about 590 ms and 226 queries:
 * consulting the edge `key` index instead of scanning, and anchoring a chain at whichever end is
 * already bound.
 *
 * `QUERY='?store=legacy'` measures the OLD store beside it, which is what production runs, and is the
 * comparison that matters: an absolute number here is about this machine, a ratio is about the code.
 *
 * Run it from inside the repo, against a `vp build` output:
 *   node_modules/.bin/vp build && node scripts/measure-home-page.mjs
 *
 * The per statement breakdown needs the timing wrapper in `engine.ts`, which is not committed: add a
 * `__graphTally` global there when you want it. Without it this reports the timings alone.
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'
const ROOT = new URL('../build/', import.meta.url).pathname
const TYPES = { '.css':'text/css','.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.map':'application/json' }
const fileFor = p => { const c = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/,'')); try { if (statSync(c).isFile()) return c } catch {} return extname(p) ? undefined : join(ROOT,'index.html') }
const server = createServer((rq,rs) => { const f = fileFor(decodeURIComponent(rq.url.split('?')[0])); if (!f) { rs.writeHead(404); rs.end(); return } rs.writeHead(200,{'content-type':TYPES[extname(f)]??'application/octet-stream'}); createReadStream(f).pipe(rs) })
await new Promise(r => server.listen(0,r))
const origin = `http://localhost:${server.address().port}`
const chrome = execFileSync('which',['google-chrome-stable'],{encoding:'utf-8'}).trim()
const browser = await chromium.launch({ headless:true, executablePath:chrome, args:['--mute-audio'] })
const page = await browser.newPage({ viewport:{width:1600,height:1100} })
const t0 = Date.now()
await page.goto(`${origin}/${process.env.QUERY ?? ''}`, { waitUntil:'domcontentloaded' })
let firstCard = null
const deadline = Date.now() + 40_000
while (Date.now() < deadline) {
  await page.waitForTimeout(100)
  if (await page.evaluate(() => document.querySelectorAll('a[href^="/media/"]').length) > 0) { firstCard = Date.now() - t0; break }
}
await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 5000))
const cards = await page.evaluate(() => document.querySelectorAll('a[href^="/media/"]').length)
let tally = null
for (const w of page.workers()) { try { const r = await w.evaluate(() => globalThis.__graphTally ? globalThis.__graphTally() : null); if (r) { tally = r; break } } catch {} }
console.log(`first card ${firstCard}ms, cards ${cards}`)
if (tally) {
  console.log(`queries ${tally.n} in ${(tally.ms/1000).toFixed(1)}s, rows ${tally.rows}`)
  for (const r of tally.top ?? []) console.log(`  ${String(r.n).padStart(4)}x ${String(r.ms).padStart(6)}ms ${String(r.rows).padStart(7)} rows  ${r.cypher}`)
}
await browser.close(); server.close()
