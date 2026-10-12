/**
 * Whether any handle in a rendered cluster carries an id that is not an id in that origin's space,
 * run against a deployed origin. Not a test: it drives the live site, so it lives here and is run by
 * hand.
 *
 *   node scripts/check-handle-ids.mjs https://anime.fkn.app
 *
 * WHAT IT LOOKS AT. Aggregated uris are rendered into the page as `/media/ag:(origin:id,...)` hrefs,
 * so every handle in a cluster is readable off the DOM. Five of the origins stub links have purely
 * NUMERIC ids, so a non-numeric one there is a positional url read that returned the wrong path
 * segment. `anizip:animedb.pl` is the case this was written for: jikan read `pathname.split('/')[2]`
 * of `/perl-bin/animedb.pl` and minted the script name as an id on every record that hit it.
 *
 * THE CONTROL IS THE POSITIVE. If no `anizip:` handle is seen at all, the check has proven nothing:
 * a page that never renders one cannot show a bad one. It fails on an empty sighting for that reason.
 *
 * Headless and muted on purpose: it reads the DOM and nothing else, so it has no business taking a
 * window or making a sound on the owner's machine.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const ORIGIN = process.argv[2] ?? 'https://anime.fkn.app'
const chrome = process.env.CHROME_PATH ?? execFileSync('which', ['google-chrome-stable'], { encoding: 'utf-8' }).trim()

/** origins whose ids are numeric in every source that mints them */
const NUMERIC = ['anidb', 'anizip', 'mal', 'anilist', 'kitsu']

// The CURRENT SEASON list and title pages, not search. MyAnimeList prints its AniDB link on a title
// page only, and its season cards and search answers carry none, so the mal source mints no anizip
// handle on a search page at all. A first version of this check swept four search queries, saw zero
// anizip handles and would have reported clean if the control had not caught it.
const PAGES = ['/', '/media/kitsu:49002', '/media/mal:1', '/media/mal:30']

const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })
const page = await browser.newPage()

await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const version = await page.evaluate(() => document.body.innerText.match(/v[\d.]+ [0-9a-f]{7}/)?.[0] ?? '(no version on page)')
console.log(`${ORIGIN}  ${version}\n`)

const seen = new Map()
for (const path of PAGES) {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(15000)
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href*="/media/"]')].map(a => a.getAttribute('href')))
  for (const href of hrefs) {
    const inner = decodeURIComponent(href ?? '').replace(/^\/media\/ag:\(|\)$/g, '').replace(/^\/media\//, '')
    for (const handle of inner.split(',')) {
      const [origin, ...rest] = handle.split(':')
      const id = rest.join(':')
      if (!origin || !id) continue
      if (!seen.has(origin)) seen.set(origin, new Set())
      seen.get(origin).add(id)
    }
  }
  console.log(`  ${path} contributed ${hrefs.length} cluster links`)
}

console.log('\nhandles seen, per origin:')
const bad = []
for (const [origin, ids] of [...seen].sort()) {
  const offenders = NUMERIC.includes(origin) ? [...ids].filter(id => !/^\d+$/.test(id)) : []
  console.log(`  ${origin.padEnd(9)} ${ids.size.toString().padStart(4)} ids${offenders.length ? `   NON NUMERIC: ${offenders.join(', ')}` : ''}`)
  bad.push(...offenders.map(id => `${origin}:${id}`))
}

const anizip = seen.get('anizip')?.size ?? 0
console.log('')
if (!anizip) {
  console.log('CONTROL FAILED: no anizip handle was rendered at all, so this run could not have seen a bad one')
  await browser.close()
  process.exit(2)
}
console.log(`control: ${anizip} anizip handles rendered, so a bad one would have been visible`)
console.log(bad.length ? `BAD: ${bad.join(', ')}` : 'no handle carries an id outside its origin\'s space')

await browser.close()
process.exit(bad.length ? 1 : 0)
