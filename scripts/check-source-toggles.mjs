/**
 * Is a built-in source turned off in Settings really left out of what stub asks? Searches once with every
 * source on, once with `source` turned off (`stub.sources.disabled`, as the Settings switch writes it),
 * and once with every source on again, and reads which origins the result cards are made of.
 *
 *   node scripts/check-source-toggles.mjs [target] [query] [source]
 *   target default https://anime.fkn.app; a directory serves that build (index.html for unknown paths)
 *   query default  frieren
 *   source default simkl
 *
 * WHY A SCRIPT AND NOT A TEST. The wiring it checks (src/worker.ts handing the list over, every fan-out
 * in src/worker/extractor.ts taking `askable`) cannot run under vitest, where worker/extractor.ts does
 * not load, and the settings spec refuses every request that leaves its own origin, so no source can
 * answer there at all. This asks the real sources through the real relay instead.
 *
 * THE CONTROL. Both "all on" arms must show `source` in the cards, or the check cannot express a failure
 * and exits 2 rather than reporting a pass. A pass is the source in both controls and absent from the
 * arm that turned it off; that arm showing it exits 1.
 *
 * Headless and muted: it reads the DOM and nothing else.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const [target = 'https://anime.fkn.app', query = 'frieren', source = 'simkl'] = process.argv.slice(2)
const SETTLE_MS = 20_000
const TYPES = { '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }

let server
let origin = target
if (existsSync(target) && statSync(target).isDirectory()) {
  const root = resolve(target)
  const fileFor = path => {
    const candidate = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''))
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    return path.startsWith('/assets/') ? undefined : join(root, 'index.html')
  }
  server = createServer((request, response) => {
    const file = fileFor(new URL(request.url, 'http://build').pathname)
    if (!file) return void response.writeHead(404).end()
    response.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(response)
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
}

const chrome = process.env.CHROME_PATH ?? execFileSync('which', ['google-chrome-stable'], { encoding: 'utf-8' }).trim()
const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })

/** The origins the search's result cards are made of, with `turnedOff` written first. */
const search = async (turnedOff) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${origin}/legal`)
  await page.evaluate(off => {
    if (off.length) localStorage.setItem('stub.sources.disabled', JSON.stringify(off))
    else localStorage.removeItem('stub.sources.disabled')
  }, turnedOff)
  await page.goto(`${origin}/search?q=${encodeURIComponent(query)}`)
  await page.waitForTimeout(SETTLE_MS)
  const hrefs = await page.$$eval('a[href*="/media/"]', links => [...new Set(links.map(link => decodeURIComponent(link.getAttribute('href'))))])
  await context.close()
  const origins = new Set()
  for (const href of hrefs) {
    const members = (href.split('/media/')[1] ?? '').split('?')[0].replace(/^ag:\(|\)$/g, '').split(',')
    for (const member of members) if (member.includes(':')) origins.add(member.split(':')[0])
  }
  return { cards: hrefs.length, origins: [...origins].sort() }
}

const before = await search([])
const off = await search([source])
const after = await search([])
await browser.close()
server?.close()

for (const [arm, result] of [['all on', before], [`${source} off`, off], ['all on again', after]]) {
  console.log(`${arm}: ${result.cards} cards from ${result.origins.join(', ') || 'nothing'}`)
}
if (!before.origins.includes(source) || !after.origins.includes(source)) {
  console.log(`CONTROL FAILED: ${source} is missing with every source on, so this search cannot show it being left out`)
  process.exit(2)
}
if (off.origins.includes(source)) {
  console.log(`FAIL: ${source} answered while turned off`)
  process.exit(1)
}
console.log(`PASS: ${source} answers with every source on and is left out while turned off`)
