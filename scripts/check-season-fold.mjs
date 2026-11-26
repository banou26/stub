/**
 * Does a run come back holding a catalogue season that CONTAINS it?
 *
 * Crunchyroll models Mushoku Tensei season 1 as one season of 23 and a special, where AniList and MAL
 * split the same broadcast into 11 and 12. The fold premieres the same day as the first of the parts
 * it contains, so a picker matching on title and premiere takes it and the run lists both parts:
 * measured on the live site 2026-09-09, part 1 showed 24 rows for an 11 episode run.
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST. It did not reproduce from the url. Pasting the address showed
 * 11, correctly, in every browser and both origins. The reproduction is a NAVIGATION: the pasted
 * address already names three sources, so the cluster resolves from them, while arriving from a
 * relation gives a bare node uri and the path that fills one in is the one that searches Crunchyroll
 * by title. So the walk is the test, and the unit half is pinned in
 * tests/unit/sources/crunchyroll/extractor.test.ts.
 *
 *   node scripts/check-season-fold.mjs                      # the live site
 *   node scripts/check-season-fold.mjs http://localhost:4560 # a dev server
 *
 * THE CONTROL WAS THE UNFIXED BUILD, run against both at once on 2026-09-09: localhost answered
 * `ok  hop 2 ... (12 rows)` while anime.fkn.app answered `FAIL hop 2 ... (24 rows)` and printed the
 * `cr:G24H1N3MP-G6NQCJ9P1` handle it had gained. So this can express the failure, which is the only
 * thing that makes a passing run mean anything.
 *
 * Headless and muted: it reads the DOM and nothing else.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const ORIGIN = process.argv[2] ?? 'https://anime.fkn.app'
const chrome = process.env.CHROME_PATH ?? execFileSync('which', ['google-chrome-stable'], { encoding: 'utf-8' }).trim()

// Mushoku Tensei season 3, and four prequel hops down to the first cour. Every run in that chain is
// one cour, and the two that Crunchyroll folds are hops 2 and 4.
const START = 'ag:(anilist:178789,anizip:18727,cr:G24H1N3MP-GS00374452,jw:222366-490814,kitsu:49002,mal:59193,nf:80987039-3,offline:mal-59193)'
const HOPS = 4
/** what each stop in the chain actually aired, so a row count has something to be wrong against */
const AIRED = [14, 12, 12, 12, 11]

const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } })

let failures = 0
const check = (ok, label, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

const settle = async () => {
  await page.waitForSelector('.episodes .episode', { timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(18_000)
  return page.evaluate(() => ({
    rows: document.querySelectorAll('.episodes .episode').length,
    // the last row's title is what says WHICH run the extra episodes came from
    last: document.querySelector('.episodes .episode:last-of-type .title')?.textContent?.trim() ?? '',
    uri: decodeURIComponent(location.pathname.replace('/media/', '')),
  }))
}

await page.goto(`${ORIGIN}/media/${START}`, { waitUntil: 'domcontentloaded' })
let state = await settle()
console.log(`${ORIGIN}\n`)
check(state.rows === AIRED[0], `season 3 lists its own ${AIRED[0]} episodes`, `${state.rows} rows`)

for (let hop = 1; hop <= HOPS; hop++) {
  const prequel = page.locator('.relation-card').filter({ has: page.locator('.relation', { hasText: /^Prequel$/ }) }).first()
  if (!await prequel.count()) { check(false, `hop ${hop} has a prequel to follow`); break }
  await prequel.click()
  state = await settle()
  const aired = AIRED[hop]
  check(
    state.rows === aired,
    `hop ${hop} lists its own ${aired} episodes rather than the season that contains it`,
    `${state.rows} rows, last "${state.last}"`
  )
  // the tell, and the only part visible without counting: the folded season arrives as a handle the
  // pasted address never carries
  if (state.rows !== aired) console.log(`        ${state.uri}`)
}

await browser.close()
if (failures) { console.log(`\n${failures} failed: a run is holding a season that contains it`); process.exit(1) }
console.log('\nevery run in the chain lists its own episodes')
