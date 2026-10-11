// Drives the real search page in a real browser, because `tsc` in this repo checks NO JSX prop
// (measured 2026-08-09) and every unit test here is a pure function. Nothing but rendering the page
// can tell you that a control is wired to the url and the url to the query.
//
// Headless and MUTED. This is DOM and routing, not a media transfer, so it needs no compositor.
//
//   npm run dev            # serves on 4560
//   node scripts/check-search-filters.mjs
//
// Run it from INSIDE the repo: an ESM script resolves bare specifiers against its own location.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const ORIGIN = process.env.STUB_ORIGIN ?? 'http://localhost:4560'

// Same detection as playwright.config.ts: this machine has no bundled chromium under the version
// playwright asks for, and `npx playwright install` cannot supply one on NixOS.
const chromePath = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (!existsSync('/etc/NIXOS')) return undefined
  for (const bin of ['google-chrome-stable', 'chromium']) {
    try { return execFileSync('which', [bin], { encoding: 'utf-8' }).trim() } catch {}
  }
  return undefined
}
const RESULTS = '.grid > .card'

let failures = 0
const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? `  (${detail})` : ''}`)
const bad = (label, detail = '') => { failures++; console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`) }
const check = (condition, label, detail) => condition ? ok(label, detail) : bad(label, detail)

const params = page => new URL(page.url()).searchParams

/**
 * Cards on the page once the count STOPS MOVING, or 0 if none ever arrive.
 *
 * A fixed delay is not good enough and measuring it proved why: at 20 seconds a two-genre filter read
 * 0 cards and at 30 seconds the same url read the 10 that actually match. The narrower the filter, the
 * later the qualifying rows land, because the only sources carrying genres are jikan (three sequential
 * season pages, then a MyAnimeList scrape) and AniList (whose public api answers 403 here, so every
 * query pays a CSRF token page first). A rig that samples too early reports a working filter as broken.
 */
const settledCards = async (page, timeout = 45_000) => {
  const started = Date.now()
  let last = -1
  let stableFor = 0
  while (Date.now() - started < timeout) {
    await page.waitForTimeout(2_000)
    const count = await page.locator(RESULTS).count()
    stableFor = count === last ? stableFor + 1 : 0
    last = count
    // two quiet samples after something arrived; an empty page has to wait out the whole budget,
    // which is what makes a zero here a measurement rather than a race
    if (count > 0 && stableFor >= 2) return count
  }
  return last > 0 ? last : 0
}

// The control is a combobox, not a button: useRole gives the reference that role, which is also what
// makes the menu a listbox and each row an option.
const pick = async (page, control, option) => {
  await page.getByRole('combobox', { name: control, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--mute-audio'] })
  const page = await browser.newContext().then(context => context.newPage())
  page.on('pageerror', error => bad('an uncaught page error', String(error).slice(0, 160)))

  console.log(`\n[search] ${ORIGIN}`)

  console.log('\nthe home page heading links into a prefilled search')
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  const heading = page.locator('a.title', { hasText: 'Current season' })
  await heading.waitFor({ timeout: 20_000 }).catch(() => {})
  const href = await heading.getAttribute('href').catch(() => null)
  check(Boolean(href), 'the heading is a link', href ?? 'it is not an anchor at all')
  const linked = href && new URL(href, ORIGIN).searchParams
  check(Boolean(linked?.get('season')) && Boolean(linked?.get('year')),
    'it carries a season and a year', href ?? '')

  console.log('\nfollowing it browses that season')
  await heading.click()
  await page.waitForURL(/\/search\?/, { timeout: 10_000 })
  const seasonCards = await settledCards(page)
  check(seasonCards > 0, 'the season page fills', `${seasonCards} cards`)
  check(params(page).get('season') === linked?.get('season'), 'the url kept the season', page.url())

  console.log('\nCONTROL: the rig can see an empty page')
  // If this reports cards, every "the filter narrowed it" result below is meaningless, because the
  // check would be incapable of observing a filter that matched nothing.
  await page.goto(`${ORIGIN}/search?genre=Notagenre${Date.now()}`, { waitUntil: 'domcontentloaded' })
  const impossible = await settledCards(page, 12_000)
  check(impossible === 0, 'a genre nothing carries yields nothing', `${impossible} cards`)
  const empty = await page.locator('.status').innerText().catch(() => '')
  check(/no results/i.test(empty), 'and says so', empty)

  console.log('\na format filter narrows the season')
  await page.goto(`${ORIGIN}/search?season=${linked?.get('season')}&year=${linked?.get('year')}`, { waitUntil: 'domcontentloaded' })
  const before = await settledCards(page)
  check(before > 0, 'the unfiltered season fills', `${before} cards`)
  await pick(page, 'Format', 'Movie')
  await page.waitForFunction(() => new URL(location.href).searchParams.get('format') === 'MOVIE', null, { timeout: 5_000 })
    .then(() => ok('the pick reaches the url'))
    .catch(() => bad('the pick reaches the url', page.url()))
  const chip = await page.locator('.chips .chip', { hasText: 'Movie' }).count()
  check(chip === 1, 'and shows a chip', `${chip} chips read Movie`)
  const after = await settledCards(page)
  check(after > 0 && after < before, 'and narrows the results', `${before} then ${after}`)

  console.log('\nthe header search box keeps the filters it found')
  // The regression this exists for: the box used to rebuild a bare /search/<term>, wiping every
  // filter from the first keypress.
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('tensei')
  await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'tensei', null, { timeout: 5_000 })
    .then(() => ok('typing reaches the url'))
    .catch(() => bad('typing reaches the url', page.url()))
  const kept = params(page)
  check(kept.get('season') === linked?.get('season'), 'the season survived the keystroke', page.url())
  check(kept.get('year') === linked?.get('year'), 'the year survived the keystroke', page.url())
  check(kept.get('format') === 'MOVIE', 'the format survived the keystroke', page.url())

  console.log('\na chip clears exactly its own filter')
  await page.locator('.chips .chip', { hasText: 'Movie' }).click()
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('format'), null, { timeout: 5_000 })
    .then(() => ok('the format is gone'))
    .catch(() => bad('the format is gone', page.url()))
  check(params(page).get('season') === linked?.get('season'), 'and the season is not', page.url())

  console.log('\nthe old /search/<term> address still lands somewhere')
  await page.goto(`${ORIGIN}/search/mushoku`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/search\?/, { timeout: 10_000 }).catch(() => {})
  check(params(page).get('q') === 'mushoku', 'it redirects into the query form', page.url())

  await browser.close()
  console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}\n`)
  process.exit(failures ? 1 : 0)
}

run().catch(error => { console.error(error); process.exit(1) })
