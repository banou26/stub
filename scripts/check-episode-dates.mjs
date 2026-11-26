// Episode rows carry the release date the sources supply, and a date-only one names the same day
// everywhere.
//
// The sources give TWO shapes and they must be treated differently, which is the whole point:
//
//   an INSTANT   `2026-07-03T15:00:00.000Z`, anizip's `airDateUtc`, 389 of the 439 dates in
//                dist-seed/snapshots.jsonl. A moment in time, so the day it falls on is genuinely
//                July 4 in Tokyo and July 3 in Los Angeles, and rendering it in the viewer's own zone
//                is the correct answer rather than a bug.
//   a NAMED DAY  `2026-08-28`, anizip's `airdate` where no UTC instant is known, the other 50. It
//                names a day and nothing else, so it has to read as that day in every zone. Parsed
//                naively it is midnight UTC, which renders as August 27 west of Greenwich.
//
// The page tells the two apart in its own markup: `releaseDateAttribute` puts the bare day in
// `datetime` for a named day and a full ISO instant for the other, so this reads the attribute to
// decide what to demand of each row.
//
// THE CONTROL is the instants. They MUST disagree across the two zones, which proves this rig can see
// a cross-zone difference at all; without it, a page that rendered nothing, or two contexts that
// silently shared a timezone, would report the named days as agreeing and pass. A run that finds no
// named day at all is INCONCLUSIVE (exit 2), not green.
//
//   npm run dev            # serves on 4560
//   node scripts/check-episode-dates.mjs
//
// Run it from INSIDE the repo: an ESM script resolves bare specifiers against its own location.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const ORIGIN = process.env.STUB_ORIGIN ?? 'http://localhost:4560'
/**
 * Tried before the home page's own cards, because a NAMED DAY is the minority shape and clusters on a
 * few runs: 17 of the 50 in dist-seed/snapshots.jsonl belong to anizip:19873 alone. Falling back to
 * the cards keeps the check working when this run leaves the season, at the cost of a run that may
 * report INCONCLUSIVE. Pushed RAW: a percent-encoded uri reaches the route undecoded and never
 * subscribes.
 */
const CANDIDATES = (process.env.STUB_MEDIA ? [process.env.STUB_MEDIA] : []).concat([
  '/media/ag:(anilist:207141,anizip:19873,jw:518630-563252,kitsu:50551,mal:63403,nf:82760630-1,offline:mal-63403)',
])
/** Nine hours east and seven west, so a UTC midnight falls on a different day in each. */
const ZONES = { east: 'Asia/Tokyo', west: 'America/Los_Angeles' }
/** `YYYY-MM-DD`, which is how the page marks a row whose source named a day rather than a moment. */
const NAMED_DAY = /^\d{4}-\d{2}-\d{2}$/
/** `Jul 3, 2026`, the shape a row falls back to once it is too old to count in days. */
const ABSOLUTE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/
/** `today`, `yesterday`, `4 days ago`, which is what a release inside the last month reads as. */
const RELATIVE = /^(today|yesterday|\d+ days ago)$/

const chromePath = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (!existsSync('/etc/NIXOS')) return undefined
  for (const bin of ['google-chrome-stable', 'chromium']) {
    try { return execFileSync('which', [bin], { encoding: 'utf-8' }).trim() } catch {}
  }
  return undefined
}

let failures = 0
const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? `  (${detail})` : ''}`)
const bad = (label, detail = '') => { failures++; console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`) }
const check = (condition, label, detail) => condition ? ok(label, detail) : bad(label, detail)

const until = async (read, want, timeout = 30_000) => {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    last = await Promise.resolve().then(read)
    if (want(last)) return last
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return last
}

/**
 * Open a media modal that actually has episodes, and read every row.
 *
 * Tries cards in turn: plenty of entries are films or have no episode list yet, and a run that
 * measured one of those would report an empty column as a pass.
 */
const readEpisodes = async (page, wanted) => {
  let fallback = undefined
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  await page.locator('a[href^="/media/"]').first().waitFor({ timeout: 60_000 })
  const hrefs = await page.locator('a[href^="/media/"]').evaluateAll(links =>
    [...new Set(links.map(link => link.getAttribute('href')).filter(Boolean))])

  for (const href of wanted ? [wanted] : [...CANDIDATES, ...hrefs.slice(0, 12)]) {
    await page.goto(`${ORIGIN}${href}`, { waitUntil: 'domcontentloaded' })
    const rows = await until(() => page.locator('.episode').count(), count => count > 0, 25_000)
    if (!rows) continue
    // the dates arrive with the subscription rather than with the first paint, so give them a moment
    await until(() => page.locator('.episode .date').count(), count => count > 0, 20_000)
    const episodes = await page.locator('.episode').evaluateAll(nodes => nodes.map(node => {
      const time = node.querySelector('.date')
      return {
        title: node.querySelector('.title')?.textContent?.trim() ?? '',
        text: time?.textContent?.trim() ?? '',
        attribute: time?.getAttribute('datetime') ?? '',
      }
    }))
    // A page whose every date is an instant cannot exercise the named-day branch, so keep looking:
    // roughly one date in nine is a named day (50 of 439 in the recorded export) and they cluster on
    // a few runs rather than spreading evenly.
    if (episodes.some(episode => NAMED_DAY.test(episode.attribute))) return { href, episodes }
    if (!fallback && episodes.some(episode => episode.text)) fallback = { href, episodes }
  }
  return fallback ?? { href: undefined, episodes: [] }
}

const main = async () => {
  console.log(`[episode dates] ${ORIGIN}`)
  const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--mute-audio'] })

  const open = async (zone, wanted) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: zone, locale: 'en-US' })
    const page = await context.newPage()
    const read = await readEpisodes(page, wanted)
    await context.close()
    return read
  }

  console.log(`\nthe rows carry a date, read from ${ZONES.east}`)
  const east = await open(ZONES.east)
  check(Boolean(east.href), 'a media with episodes was found to measure', east.href ?? 'no candidate had any')
  if (!east.href) { await browser.close(); console.log('\nINCONCLUSIVE: nothing to measure'); process.exit(2) }

  const dated = east.episodes.filter(episode => episode.text)
  check(east.episodes.length > 0, 'the modal rendered episode rows', `${east.episodes.length} rows`)
  check(dated.length > 0, 'and at least one carries a release date', `${dated.length} of ${east.episodes.length}`)
  check(
    dated.every(episode => episode.attribute && !Number.isNaN(new Date(episode.attribute).getTime())),
    'every date shown carries a machine-readable value beside it',
    `${dated.filter(episode => episode.attribute).length} of ${dated.length}`,
  )
  check(
    dated.every(episode => ABSOLUTE.test(episode.text) || RELATIVE.test(episode.text)),
    'and reads either as a count of days or as a day, never as a timestamp',
    dated.slice(0, 4).map(episode => episode.text).join(' | '),
  )
  check(
    dated.every(episode => !RELATIVE.test(episode.text) || new Date(episode.attribute).getTime() <= Date.now()),
    'and only a release that has already happened counts backwards',
    `${dated.filter(episode => RELATIVE.test(episode.text)).length} of ${dated.length} count days`,
  )

  console.log(`\nand the same rows read from ${ZONES.west}`)
  const west = await open(ZONES.west, east.href)
  const pairs = east.episodes
    .map((episode, index) => ({ east: episode, west: west.episodes[index] }))
    .filter(pair => pair.west && pair.east.attribute && pair.west.attribute && pair.east.attribute === pair.west.attribute)
  check(pairs.length > 0, 'the same rows came back in the other zone, so there is something to compare', `${pairs.length} rows`)

  // Only rows showing an ABSOLUTE date can be compared across zones. A row inside the last month
  // shows a count of days instead, and that count is measured from the VIEWER's today, so two zones
  // sitting on different calendar dates disagree by one legitimately. Which rows those are changes
  // with the hour the check runs at, so they are excluded by what they display rather than by a
  // guess about the clock.
  const comparable = pairs.filter(pair => ABSOLUTE.test(pair.east.text) && ABSOLUTE.test(pair.west.text))
  const namedDays = comparable.filter(pair => NAMED_DAY.test(pair.east.attribute))
  const instants = comparable.filter(pair => !NAMED_DAY.test(pair.east.attribute))
  check(comparable.length > 0, 'some rows show a date rather than a count, so they can be compared', `${comparable.length} of ${pairs.length}`)

  // THE CONTROL, and it is the instants rather than an assumption. If two contexts pinned nine and
  // seven hours apart render the SAME day for a moment that falls either side of midnight, then this
  // rig is not measuring two zones at all and everything below it is worthless.
  const shifted = instants.filter(pair => pair.east.text !== pair.west.text)
  check(
    shifted.length > 0,
    'CONTROL: a timestamped airing reads as a different day in the two zones, so the rig sees zones',
    instants.length
      ? `${shifted.length} of ${instants.length} shifted, e.g. ${shifted[0]?.east.attribute ?? ''}: ${shifted[0]?.east.text ?? ''} against ${shifted[0]?.west.text ?? ''}`
      : 'no timestamped airing on this page',
  )

  check(namedDays.length > 0, 'the page has a row whose source named a day rather than a moment', `${namedDays.length} of ${pairs.length}`)
  if (!namedDays.length || !shifted.length) {
    await browser.close()
    // Deliberately NOT a pass. The named-day branch is the one the whole thing exists for, and a run
    // that could not reach it has tested the easy half only.
    //
    // Where they come from, measured live 2026-09-08 over ten anizip ids, 132 episodes: `airdate` is
    // present on all of them and `airDateUtc` on 94, so a named day is what is left when an episode
    // has no known broadcast INSTANT. On anidb 16392 that is the eight specials against twelve
    // numbered episodes; anizip 19486 has three numbered ones. Which of those a home page happens to
    // be showing changes week to week, and anizip fills a UTC time in as an airing approaches, so a
    // run can stop being able to reach it without anything having broken.
    //
    // tests/unit/utils/release-date.test.ts covers the branch unconditionally, pinning six real
    // zones, and mutating the UTC formatting away turns it red. Point a run here with STUB_MEDIA=...
    console.log('\nINCONCLUSIVE: no episode here has a date without a time, so the day boundary is untested')
    console.log('             tests/unit/utils/release-date.test.ts pins it; STUB_MEDIA=<uri> aims this at a run that has one')
    process.exit(2)
  }

  const disagreed = namedDays.filter(pair => pair.east.text !== pair.west.text)
  check(
    disagreed.length === 0,
    'and every named day reads as that same day in both zones',
    disagreed.length
      ? `${disagreed.length} differ, e.g. ${disagreed[0].east.attribute}: ${disagreed[0].east.text} against ${disagreed[0].west.text}`
      : `${namedDays.length} rows agree, e.g. ${namedDays[0].east.attribute} shown as ${namedDays[0].east.text}`,
  )

  // and it is the day the source actually named, not merely a day both zones agree on
  const wrongDay = namedDays.filter(pair => {
    const [year, month, day] = pair.east.attribute.split('-').map(Number)
    const named = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, day)))
    return pair.east.text !== named
  })
  check(wrongDay.length === 0, 'and it is the day the source named', wrongDay.length ? `${wrongDay[0].east.attribute} shown as ${wrongDay[0].east.text}` : `${namedDays.length} rows`)

  await browser.close()
  console.log(failures ? `\n${failures} FAILED` : '\nall good')
  process.exit(failures ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(2) })
