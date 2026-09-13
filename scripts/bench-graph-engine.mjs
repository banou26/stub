/**
 * What does each proposed graph-engine change actually BUY? One workload, both variants, measured.
 *
 * Built for the 2026-09-13 perf work, where a Mushoku Tensei modal spent ~20 s of worker time. The
 * three candidate fixes were "move LadybugDB in-process", "narrow the projections" and "batch the
 * N+1 lookups", and the whole point of this rig is that they could be PRICED against each other
 * instead of argued about. The answer that day, medians of 3 interleaved reps:
 *
 *   1000 point queries          2175 ms async / 1352 ms sync
 *   the same 1000, BATCHED        24 ms async /   19 ms sync      <- 90x, and it dwarfs the rest
 *   18 fat scans (54k rows)      502 ms async /  335 ms sync
 *   18 scans, narrow projection  236 ms async /  196 ms sync      <- 2x from dropping one column
 *
 * So: batching beats everything, narrowing is worth 2x, and moving in-process is worth about 1.5x.
 *
 * INTERLEAVE AND REPEAT, always. This machine's load moved by 5x mid-run while another job was
 * going, which made one arm look 5x slower than it was. Arms measured back to back measure the load.
 *
 * Run it from inside the repo:
 *   node_modules/.bin/vp build --config vite.bench.config.ts && node scripts/bench-graph-engine.mjs
 *
 * Env: REPS (default 3), ARMS (default "async,sync"), CHROME_PATH.
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

const OUT = new URL('../bench-out/', import.meta.url).pathname
const PKG = new URL('../node_modules/@ladybugdb/wasm-core/', import.meta.url).pathname
const TYPES = { '.css':'text/css','.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.map':'application/json' }
const server = createServer((rq, rs) => {
  const path = decodeURIComponent(rq.url.split('?')[0])
  // the two engine files are served from the package rather than bundled, exactly as production
  // serves lbug_wasm_worker.js: both carry the wasm as raw bytes and are 22 MB
  const file = path === '/lbug_sync.js' ? join(PKG, 'sync/index.js')
    : path === '/lbug_wasm_worker.js' ? join(PKG, 'lbug_wasm_worker.js')
      : join(OUT, normalize(path === '/' ? '/scripts/bench/index.html' : path).replace(/^(\.\.[/\\])+/, ''))
  try { statSync(file) } catch { rs.writeHead(404); rs.end('no'); return }
  rs.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(rs)
})
await new Promise(r => server.listen(0, r))
const origin = `http://localhost:${server.address().port}`
const chrome = process.env.CHROME_PATH ?? execFileSync('which', ['google-chrome-stable'], { encoding:'utf-8' }).trim()
const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })

const arms = (process.env.ARMS ?? 'async,sync').split(',')
const REPS = Number(process.env.REPS ?? 3)
const runs = {}
for (const a of arms) runs[a] = []
// INTERLEAVED and repeated, never one arm then the other. This machine's load moves by 5x while a
// run is in flight (measured 2026-09-13 with a load average of 31 from another job), so two arms
// measured back to back are measuring the load as much as the code. Alternating and taking a median
// is what makes the ratio mean anything.
for (let rep = 0; rep < REPS; rep += 1) {
  for (const arm of arms) {
    // a FRESH page per arm, so neither engine is warm from the other and 22 MB of wasm compiles once
    const page = await browser.newPage()
    page.on('pageerror', e => console.log(`  [${arm}] pageerror:`, String(e?.message ?? e).slice(0, 200)))
    await page.goto(`${origin}/scripts/bench/index.html`, { waitUntil: 'networkidle' })
    const started = Date.now()
    const out = await page.evaluate(a => window.__bench(a), arm)
    runs[arm].push({ ...out, wallMs: Date.now() - started })
    await page.close()
  }
  console.log(`rep ${rep + 1}/${REPS} done`)
}
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const results = {}
for (const arm of arms) {
  const ok = runs[arm].filter(r => r.ok)
  if (!ok.length) { results[arm] = runs[arm][0]; continue }
  results[arm] = {
    ok: true, label: ok[0].label,
    openMs: median(ok.map(r => r.openMs)),
    wallMs: median(ok.map(r => r.wallMs)),
    marks: ok[0].marks.map((m, i) => ({ label: m.label, ms: median(ok.map(r => r.marks[i].ms)) })),
    spread: ok[0].marks.map((m, i) => {
      const xs = ok.map(r => r.marks[i].ms)
      return `${Math.min(...xs)}..${Math.max(...xs)}`
    }),
  }
}
for (const [arm, r] of Object.entries(results)) {
  if (!r.ok) { console.log(`${arm}: FAILED\n${r.error}`); continue }
  console.log(`\n=== ${arm}: ${r.label} ===`)
  console.log(`  open + compile wasm : ${r.openMs} ms`)
  for (let i = 0; i < r.marks.length; i += 1) console.log(`  ${String(r.marks[i].ms).padStart(7)} ms  (${r.spread?.[i] ?? '-'})  ${r.marks[i].label}`)
  console.log(`  ${String(r.wallMs).padStart(7)} ms  TOTAL (incl. open)`)
}
if (results.async?.ok && results.sync?.ok) {
  console.log('\n=== sync vs async, per phase ===')
  for (let i = 0; i < results.async.marks.length; i += 1) {
    const a = results.async.marks[i], s = results.sync.marks[i]
    const speedup = a.ms / Math.max(1, s.ms)
    console.log(`  ${a.label}\n      async ${String(a.ms).padStart(7)} ms   sync ${String(s.ms).padStart(7)} ms   ${speedup.toFixed(1)}x`)
  }
}
await browser.close(); server.close()
