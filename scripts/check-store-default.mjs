/**
 * Is the GRAPH the store a page reads when nobody asks for anything?
 *
 * The default flipped on 2026-09-13: the graph ships, and `?store=legacy` is the only way back to
 * the old store. This is the check for that, and it is three arms rather than one because the
 * interesting failure is silent. A flip that did not take, and an opt out that no longer works, both
 * render a perfectly normal page.
 *
 * TWO THINGS IT GETS RIGHT THAT COST THREE ATTEMPTS TO LEARN, both about the check rather than the app:
 *  - it uses a uri where the two stores DISAGREE. Season 3 places Netflix episodes on both, so it
 *    cannot tell them apart, and an opt out that did nothing still passed. Season 2 cour 1 is 7
 *    against 0, so every arm is falsifiable.
 *  - it waits a FIXED window and never breaks early on a stable-looking page. The catalogue rows
 *    render in a second or two and then the page sits still for tens of seconds before the Netflix
 *    rows arrive, so an early break measured the lull and reported zero twice in a row.
 *
 * Run it from inside the repo, against a `vp build` output:
 *   node_modules/.bin/vp build && node scripts/check-store-default.mjs
 *
 * Env: URI, SETTLE_MS (default 75s per arm, so a full run is a few minutes), CHROME_PATH.
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
// 146065, season 2 cour 1, DELIBERATELY. Season 3 places Netflix on both stores, so it cannot tell
// them apart and an opt-out that did nothing would still pass. This run is the one where they
// disagree: 7 Netflix episodes on the graph and 0 on the legacy store (measured 2026-09-13).
const uri = process.env.URI ?? 'ag:(anilist:146065,anizip:17236,kitsu:45950,mal:51179,offline:mal-51179)'
const read = async (query, label) => {
  const page = await browser.newPage({ viewport:{width:1600,height:1100} })
  await page.goto(`${origin}/media/${encodeURIComponent(uri)}${query}`, { waitUntil:'domcontentloaded' })
  let shot = {}
  // SETTLE, never "first paint with episodes". The rows from the cached catalogues render within a
  // second or two, while the Netflix ones only arrive after the similar-consumer has asked Netflix
  // and the pass has placed them. Breaking on the first non-empty list measured the wrong moment and
  // reported the default arm as carrying no Netflix at all, which was a fact about the check.
  const deadline = Date.now() + Number(process.env.SETTLE_MS ?? 75_000)
  let stable = 0
  let last = ''
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000)
    shot = await page.evaluate(() => {
      const eps = [...document.querySelectorAll('.episodes > .episode')]
      const tally = {}
      for (const e of eps) for (const t of new Set([...e.querySelectorAll('[title]')].map(n => n.getAttribute('title')))) tally[t] = (tally[t] ?? 0) + 1
      return { episodes: eps.length, nf: Object.entries(tally).filter(([n]) => /netflix/i.test(n)).reduce((s,[,n]) => s+n, 0), address: location.pathname + location.search }
    })
    const key = JSON.stringify(shot)
    stable = key === last ? stable + 1 : 0
    last = key
    // NO EARLY BREAK on stability. The Netflix rows arrive after the similar-consumer has asked
    // Netflix, placed the season and run a pass, and the page sits perfectly still for tens of
    // seconds in between: a stability break measured that lull and reported zero, twice.
    // check-netflix-episodes.mjs waits a fixed window for the same reason.
  }
  await page.close()
  console.log(`  ${label.padEnd(28)} episodes ${String(shot.episodes).padStart(3)}  netflix ${String(shot.nf).padStart(3)}`)
  return shot
}
console.log('reading the SAME uri three ways:\n')
const bare = await read('', 'no flags at all (default)')
const explicit = await read('?graph=1&store=graph', 'the old explicit opt in')
const legacy = await read('?store=legacy', 'the new opt out (legacy)')
await browser.close(); server.close()
const fail = []
if (!bare.nf) fail.push('the DEFAULT page showed no netflix episodes: the flip did not take')
if (bare.nf !== explicit.nf) fail.push(`default (${bare.nf}) and explicit (${explicit.nf}) disagree`)
if (legacy.nf === bare.nf) fail.push(`?store=legacy showed the same ${legacy.nf} as the default: on THIS uri the two stores differ, so the opt out did nothing`)
console.log(fail.length ? `\nFAIL:\n  ${fail.join('\n  ')}` : '\nok: the graph is the default, and ?store=legacy still reaches the old store')
if (fail.length) process.exitCode = 1
