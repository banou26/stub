// Drives the search page's three display modes in a real browser. `tsc` in this repo checks NO JSX
// prop (measured 2026-08-09) and the unit tests beside this are pure functions, so nothing but
// rendering the page can tell you that the toggle is wired to the layout, that the layout survives a
// reload, or that the fields the card and list modes lead with actually arrive over the wire.
//
// Headless and MUTED. This is DOM and routing, not a media transfer, so it needs no compositor.
//
//   npm run dev            # serves on 4560
//   node scripts/check-display-modes.mjs
//   node scripts/check-display-modes.mjs --shots /tmp/modes   # one png per mode as well
//
// Run it from INSIDE the repo: an ESM script resolves bare specifiers against its own location.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const ORIGIN = process.env.STUB_ORIGIN ?? 'http://localhost:4560'
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : undefined

const chromePath = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (!existsSync('/etc/NIXOS')) return undefined
  for (const bin of ['google-chrome-stable', 'chromium']) {
    try { return execFileSync('which', [bin], { encoding: 'utf-8' }).trim() } catch {}
  }
  return undefined
}

// Each mode's container and the item inside it. A mode is "showing" only when its own container holds
// items AND the other two containers are gone: a page that rendered two layouts at once would pass a
// check that only counted one of them.
const MODES = {
  grid: { label: 'Covers', items: '.grid > .card' },
  card: { label: 'Cards', items: '.cards > a' },
  list: { label: 'List', items: '.rows > a' },
}

let failures = 0
const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? `  (${detail})` : ''}`)
const bad = (label, detail = '') => { failures++; console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`) }
const check = (condition, label, detail) => condition ? ok(label, detail) : bad(label, detail)

/** Items on the page once the count STOPS MOVING. See check-search-filters.mjs for why a fixed delay is not enough. */
const settled = async (page, selector, timeout = 45_000) => {
  const started = Date.now()
  let last = -1
  let stableFor = 0
  while (Date.now() - started < timeout) {
    await page.waitForTimeout(2_000)
    const count = await page.locator(selector).count()
    stableFor = count === last ? stableFor + 1 : 0
    last = count
    if (count > 0 && stableFor >= 2) return count
  }
  return last > 0 ? last : 0
}

const counts = async page => Object.fromEntries(await Promise.all(
  Object.entries(MODES).map(async ([mode, spec]) => [mode, await page.locator(spec.items).count()])
))

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--mute-audio'] })
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', error => bad('an uncaught page error', String(error).slice(0, 160)))
  if (shotsAt) mkdirSync(shotsAt, { recursive: true })

  console.log(`\n[display modes] ${ORIGIN}`)

  // A season browse rather than a text search: it is the widest page the store can fill, and the airing
  // countdown only exists on a season that is still running.
  const now = new Date()
  const season = ['WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL', 'WINTER'][now.getMonth()]
  const year = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear()
  await page.goto(`${ORIGIN}/search?season=${season}&year=${year}`, { waitUntil: 'domcontentloaded' })

  console.log('\nthe default layout is covers')
  const first = await settled(page, MODES.grid.items)
  check(first > 0, 'the season page fills', `${first} covers`)
  if (!first) {
    console.log('\nRIG BLIND: nothing rendered, so every result below would be vacuous')
    await browser.close()
    process.exit(2)
  }

  const rendered = {}
  for (const [mode, spec] of Object.entries(MODES)) {
    console.log(`\n${mode}`)
    await page.getByRole('button', { name: spec.label, exact: true }).click()
    const shown = await settled(page, spec.items, 15_000)
    const all = await counts(page)
    check(shown > 0, `${mode} renders its own items`, `${shown}`)
    const others = Object.entries(all).filter(([other]) => other !== mode)
    check(others.every(([, count]) => count === 0), 'and only its own', others.map(([o, c]) => `${o}=${c}`).join(' '))
    rendered[mode] = shown
    if (shotsAt) await page.screenshot({ path: `${shotsAt}/${mode}.png`, fullPage: false })
  }

  console.log('\nevery mode renders the same results')
  // Measured back to back, NEVER against the count taken before the first switch. Results keep
  // ARRIVING while a mode is being read: on production the page settles at 92 from the bundled season
  // data and reaches 95 once the live sources answer, so a baseline captured early fails all three
  // modes for a reason that has nothing to do with any of them.
  const again = {}
  for (const [mode, spec] of Object.entries(MODES)) {
    await page.getByRole('button', { name: spec.label, exact: true }).click()
    await page.waitForTimeout(1_000)
    again[mode] = await page.locator(spec.items).count()
  }
  const values = Object.values(again)
  check(values.every(count => count === values[0]) && values[0] > 0,
    'the three modes agree', Object.entries(again).map(([mode, count]) => `${mode}=${count}`).join(' '))

  console.log('\nthe choice survives a reload, and a different search')
  await page.reload({ waitUntil: 'domcontentloaded' })
  const afterReload = await settled(page, MODES.list.items, 20_000)
  check(afterReload > 0, 'the reloaded page is still a list', `${afterReload} rows`)
  await page.goto(`${ORIGIN}/search?q=tensei`, { waitUntil: 'domcontentloaded' })
  const afterSearch = await settled(page, MODES.list.items, 30_000)
  check(afterSearch > 0, 'and so is the next search', `${afterSearch} rows`)

  console.log('\nCONTROL: the rig can tell a mode apart from its neighbours')
  // If this reports items, every count above is meaningless, because the check would be incapable of
  // observing a layout that rendered nothing.
  await page.goto(`${ORIGIN}/search?genre=Notagenre${Date.now()}`, { waitUntil: 'domcontentloaded' })
  const impossible = await settled(page, Object.values(MODES).map(spec => spec.items).join(', '), 12_000)
  check(impossible === 0, 'a genre nothing carries renders no items in any mode', `${impossible}`)

  console.log('\nthe fields only these modes read actually arrive')
  // Waiting on the ROW COUNT is not enough and reported a false failure on production: the bundled
  // season data fills the rows in one go, so the count settles BEFORE AniList answers, and AniList is
  // the only source that publishes a schedule. Both fields are waited on where they render.
  await page.goto(`${ORIGIN}/search?season=${season}&year=${year}`, { waitUntil: 'domcontentloaded' })
  await settled(page, MODES.list.items)
  const rows = page.locator(MODES.list.items)
  const scored = await settled(page, `${MODES.list.items} [aria-label^="Rated "]`, 60_000)
  check(scored > 0, 'a rating reaches the rows', `${scored} of ${await rows.count()}`)
  const airing = await settled(page, `${MODES.list.items} .airing`, 60_000)
  check(airing > 0, 'and so does a scheduled episode', `${airing} rows counting down`)

  console.log('\nno card shows more description than it clamps to')
  // `-webkit-line-clamp` writes the ellipsis and leaves the lines after it in the box: it only hides
  // them because `overflow: hidden` sits over a box the clamped text exactly fills. A description
  // stretched by its column showed three clamped lines and then two more below the ellipsis, at every
  // width where the card had spare height. Measured, because a screenshot of the wide layout does not
  // show it.
  await page.getByRole('button', { name: MODES.card.label, exact: true }).click()
  await settled(page, MODES.card.items, 15_000)
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(500)
    const overflowing = await page.locator(MODES.card.items).evaluateAll(cards => cards.filter(card => {
      const description = card.querySelector('.description')
      const style = getComputedStyle(description)
      const lines = Number(style.webkitLineClamp)
      if (!lines) return true
      return description.getBoundingClientRect().height > lines * parseFloat(style.lineHeight) + 1
    }).length)
    check(overflowing === 0, `at ${width}px every description is at most its clamp`, `${overflowing} taller than their clamp`)
  }

  await browser.close()
  console.log(failures ? `\n${failures} failed\n` : '\nall good\n')
  process.exit(failures ? 1 : 0)
}

run().catch(error => { console.error(error); process.exit(1) })
