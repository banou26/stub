// A follower GLIDES to where the host scrolled, rather than jumping there.
//
// The only honest way to see a glide is to watch for the positions in between: a jump moves once and
// stops, an animation passes through. So this samples the follower's scroll position every frame
// while it follows, and counts the distinct positions strictly between where it started and where it
// ended up.
//
// THE CONTROL IS A SECOND FOLLOWER in the same party, in a context emulating
// `prefers-reduced-motion: reduce`. It receives the identical message over the identical code path
// and must show essentially none: one or two is a SECOND MESSAGE, not an animation, since a page that
// reflows under the host sends its new position and the follower jumps again. Without the control a
// rig that samples too slowly, or a page that happens to reflow, would report a glide from a jump and
// there would be no way to tell.
//
// Every control also has to be shown to have MOVED. A follower that received nothing at all shows no
// in-between positions either, and would otherwise pass as a well-behaved jump.
//
//   npm run dev            # serves on 4560
//   node scripts/check-party-scroll.mjs
//
// Run it from INSIDE the repo: an ESM script resolves bare specifiers against its own location.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const ORIGIN = process.env.STUB_ORIGIN ?? 'http://localhost:4560'
const PAGE = '/search?season=FALL&year=2026'

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

const until = async (read, want, timeout = 20_000) => {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    last = await read()
    if (want(last)) return last
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return last
}

const widget = page => page.getByRole('button', { name: /Watch party|Hosting|Following|Joining|Party/ })

/**
 * Record a page's scroll position every frame, until it is read back.
 *
 * `where` says which box: the page, or the marked container the modal is. One sampler rather than one
 * per scenario, so a fix to how sampling works cannot apply to half of them.
 */
const startSampling = (page, where = 'page') => page.evaluate(which => {
  const samples = []
  Object.assign(window, { __samples: samples })
  const read = which === 'page'
    ? () => window.scrollY
    : () => document.querySelector('[data-party-scroll]')?.scrollTop ?? 0
  const tick = () => { samples.push(read()); window.__raf = requestAnimationFrame(tick) }
  window.__raf = requestAnimationFrame(tick)
}, where)

const readSamples = page => page.evaluate(() => {
  cancelAnimationFrame(window.__raf)
  return window.__samples
})

/** Distinct positions strictly between the first sample and the last: an animation's footprints. */
const inBetween = samples => {
  if (samples.length < 2) return 0
  const from = samples[0]
  const to = samples.at(-1)
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  // a pixel of slack at each end, so a settling sub-pixel value is not counted as a step
  return new Set(samples.filter(value => value > low + 1 && value < high - 1)).size
}

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--mute-audio'] })
  const host = await browser.newContext().then(context => context.newPage())
  const guest = await browser.newContext().then(context => context.newPage())
  // the control: same party, same message, same code, and a viewer who asked not to be animated
  const still = await browser.newContext({ reducedMotion: 'reduce' }).then(context => context.newPage())

  for (const [name, page] of [['host', host], ['guest', guest], ['still guest', still]]) {
    page.on('pageerror', error => {
      if (/^(TypeError: )?Failed to fetch$/.test(String(error).trim())) return
      console.log(`  warn  page error on the ${name}: ${String(error).slice(0, 120)}`)
    })
  }

  console.log(`[party scroll] ${ORIGIN}`)
  console.log('\na host with two followers on one page')
  await host.goto(`${ORIGIN}${PAGE}`, { waitUntil: 'domcontentloaded' })
  await widget(host).waitFor({ timeout: 30_000 })
  let hosting = ''
  for (let attempt = 0; attempt < 4 && !/Hosting/.test(hosting); attempt++) {
    await widget(host).click().catch(() => {})
    hosting = await until(() => widget(host).innerText().catch(() => ''), text => /Hosting/.test(text), 6_000)
  }
  check(/Hosting/.test(hosting), 'the host is hosting', hosting.replace(/\s+/g, ' '))
  if (!/Hosting/.test(hosting)) { await browser.close(); process.exit(2) }

  await widget(host).click()
  const link = await host.getByRole('textbox', { name: 'Invite link' }).inputValue()
  await host.keyboard.press('Escape')

  for (const [name, page] of [['guest', guest], ['still guest', still]]) {
    await page.goto(link, { waitUntil: 'domcontentloaded' })
    const text = await until(() => widget(page).innerText().catch(() => ''), value => /Following/.test(value), 30_000)
    check(/Following/.test(text), `the ${name} is following`, text.replace(/\s+/g, ' '))
  }

  // both followers must be ON the host's page before a scroll means anything to them
  for (const page of [guest, still]) {
    await until(() => page.evaluate(() => location.pathname + location.search), value => value.startsWith('/search?'), 30_000)
    await page.locator('.grid > .card').first().waitFor({ timeout: 45_000 }).catch(() => {})
  }
  await host.locator('.grid > .card').first().waitFor({ timeout: 45_000 }).catch(() => {})
  // settle: a page still laying out changes the height a fraction is read against
  await host.waitForTimeout(2_000)

  console.log('\nthe host scrolls about a screen, and the followers come along')
  for (const page of [guest, still]) await startSampling(page)
  const target = await host.evaluate(() => {
    // one screen and a bit: inside the distance a follower will glide rather than jump
    const top = Math.round(window.innerHeight * 1.2)
    window.scrollTo({ top })
    return top
  })
  const arrived = await until(() => guest.evaluate(() => window.scrollY), y => y > target * 0.5, 15_000)
  await guest.waitForTimeout(1_500)
  // Stopped at the SAME MOMENT: read one after the other and the second keeps sampling through the
  // first's round trip, so a later message counts against the control and not against the glide.
  const [moving, frozen] = await Promise.all([readSamples(guest), readSamples(still)])

  check(arrived > target * 0.5, 'the guest followed the host down', `${Math.round(arrived)}px of ~${target}px`)
  const glided = inBetween(moving)
  const jumped = inBetween(frozen)
  // An animation leaves a footprint on nearly every frame for a few hundred milliseconds; a jump
  // leaves none. A control of one or two is a SECOND MESSAGE, not an animation: a page that reflows
  // under the host sends its new position and the follower jumps again.
  check(glided >= 8, 'the guest passed through the positions in between, so it glided', `${glided} in-between positions`)
  check(jumped <= 2, 'and the control, which asked for less motion, jumped instead', `${jumped} in-between positions`)
  check(glided >= 5 * Math.max(1, jumped), 'and the difference is a kind, not a degree', `${glided} against ${jumped}`)
  check((frozen.at(-1) ?? 0) > target * 0.5, 'the control still arrived, so it is a real follower and not a broken one', `${Math.round(frozen.at(-1) ?? 0)}px`)

  // The other branch. scrollTo picks a marked container over the page, and the media modal is one:
  // it locks the body and scrolls inside itself, so `element.scrollTo` is what runs there rather than
  // `window.scrollTo`. A unit test can pin which options are passed; only this can show the browser
  // honouring them on an element.
  console.log('\nand inside the media modal, which scrolls itself rather than the page')
  await host.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  await host.locator('a[href^="/media/"]').first().click({ timeout: 60_000 })
  const opened = await until(() => host.evaluate(() => document.querySelectorAll('[data-party-scroll]').length), count => count > 0, 30_000)
  check(opened > 0, 'the host opened a media modal', `${opened} marked container`)

  const guestsInModal = []
  for (const [name, page] of [['guest', guest], ['still guest', still]]) {
    const here = await until(
      () => page.evaluate(() => document.querySelectorAll('[data-party-scroll]').length),
      count => count > 0,
      30_000,
    )
    check(here > 0, `the ${name} followed into the modal`, `${here} marked container`)
    guestsInModal.push(here > 0)
  }

  if (guestsInModal.every(Boolean)) {
    // Start from a KNOWN position. A guest arriving in the modal has usually already been placed by a
    // state heartbeat, and sampling from wherever that left it measures a follower that barely has to
    // move: the first sample equals the last and the run reports a jump from a glide. Put the host's
    // modal at the top, wait for the followers to be there too, and only then start watching.
    await host.evaluate(() => { document.querySelector('[data-party-scroll]').scrollTop = 0 })
    for (const page of [guest, still]) {
      await until(
        () => page.evaluate(() => document.querySelector('[data-party-scroll]')?.scrollTop ?? -1),
        top => top >= 0 && top < 40,
        15_000,
      )
    }
    await host.waitForTimeout(2_000)

    const sample = page => startSampling(page, 'container')
    const read = page => readSamples(page)
    const topOf = page => page.evaluate(() => document.querySelector('[data-party-scroll]')?.scrollTop ?? -1)

    // ATTEMPTED MORE THAN ONCE, and this is about the rig rather than the product. A follower ignores
    // a scroll for a page it is not on yet, and the host's own record of where the party is settles a
    // moment after the modal opens, so the first message can land in that gap and move nobody. Each
    // attempt puts both back at the top and tries again; a follower that never moves at all is a real
    // failure and is reported as one below.
    let room = 0
    let movingModal = []
    let frozenModal = []
    for (let attempt = 0; attempt < 3; attempt++) {
      await host.evaluate(() => { document.querySelector('[data-party-scroll]').scrollTop = 0 })
      for (const page of [guest, still]) await until(() => topOf(page), top => top >= 0 && top < 40, 10_000)
      await host.waitForTimeout(1_000)
      for (const page of [guest, still]) await sample(page)
      room = await host.evaluate(() => {
        const box = document.querySelector('[data-party-scroll]')
        // Deliberately under one screenful. A modal's room can be several screens deep, and a follower
        // whose copy of it is taller than the host's covers more pixels for the same fraction: at 80%
        // of the room that came to 1,673px against a 1,440px cap, so the follower correctly JUMPED and
        // the run read as a missing glide. This is the tier the section is about.
        const top = Math.min(box.scrollHeight - box.clientHeight, Math.round(box.clientHeight * 0.6))
        box.scrollTo({ top })
        return top
      })
      // A fixed window rather than a poll that returns the instant the follower is part way: reading
      // mid-animation truncates the very samples this is looking for.
      await guest.waitForTimeout(4_000)
      ;[movingModal, frozenModal] = await Promise.all([read(guest), read(still)])
      if ((movingModal.at(-1) ?? 0) > 20) break
      console.log(`  ...  the follower did not move on attempt ${attempt + 1}, trying again`)
    }

    // COMPARED AS FRACTIONS, not as pixels. The party syncs a fraction of each page's own scrollable
    // room, and two copies of the same modal are rarely the same height: whichever images have loaded
    // changes it. A run that compared the follower's pixels against the host's read a correct follow
    // sitting at its own bottom (130px of its own 130px) as having gone nowhere.
    const where = page => page.evaluate(() => {
      const box = document.querySelector('[data-party-scroll]')
      const room = box.scrollHeight - box.clientHeight
      return { fraction: room > 0 ? box.scrollTop / room : 0, room, top: box.scrollTop, screen: box.clientHeight }
    })
    const hostAt = await where(host)
    const guestAt = await where(guest)

    check(room > 20, 'the host moved inside the modal at all, so this can measure something', `${room}px`)
    check((movingModal[0] ?? -1) < 40, 'and the follower started at the top, so there was a distance to cover', `started at ${Math.round(movingModal[0] ?? -1)}px`)
    check(guestAt.room > 20, 'the follower has a modal it can scroll', `${Math.round(guestAt.room)}px of room`)
    check(Math.abs(guestAt.fraction - hostAt.fraction) < 0.15, 'the guest is where the host is in the modal, as a fraction of each one\'s own room', `${guestAt.fraction.toFixed(2)} against ${hostAt.fraction.toFixed(2)}`)
    check(guestAt.top <= guestAt.screen * 2, 'and it was a distance a glide covers, or this section measures the cap instead', `${Math.round(guestAt.top)}px against a ${Math.round(guestAt.screen * 2)}px cap`)
    check(inBetween(movingModal) >= 8, 'and glided there', `${inBetween(movingModal)} in-between positions`)
    check(inBetween(frozenModal) <= 2, 'while the control jumped', `${inBetween(frozenModal)} in-between positions`)
    // without this the control passes by having received nothing at all, which is not a jump
    check((frozenModal.at(-1) ?? 0) > 20, 'and the control did move, so its silence is a jump and not a failure', `${Math.round(frozenModal.at(-1) ?? 0)}px`)
  }

  // The scenario a person is actually in: the host does not scroll once, they keep scrolling. This is
  // the risk of animating at all, so it is worth its own section. A follower whose glide is retargeted
  // twice a second must still END UP where the host is, rather than trailing further behind with every
  // message and never arriving.
  console.log('\nand keeps up with a host who keeps scrolling')
  await host.goto(`${ORIGIN}${PAGE}`, { waitUntil: 'domcontentloaded' })
  await until(() => guest.evaluate(() => location.pathname + location.search), where => where.startsWith('/search?'), 30_000)
  for (const page of [host, guest]) await page.locator('.grid > .card').first().waitFor({ timeout: 45_000 }).catch(() => {})
  await host.evaluate(() => window.scrollTo({ top: 0 }))
  await until(() => guest.evaluate(() => window.scrollY), y => y < 60, 15_000)
  await host.waitForTimeout(1_500)
  await startSampling(guest)
  // eight steps of about a third of a screen over four seconds, which is an ordinary reading scroll
  for (let step = 1; step <= 8; step++) {
    await host.evaluate(n => window.scrollTo({ top: Math.round(window.innerHeight * 0.35 * n) }), step)
    await host.waitForTimeout(500)
  }
  await guest.waitForTimeout(3_000)
  const chased = await readSamples(guest)
  const ends = await Promise.all([host, guest].map(page => page.evaluate(() => {
    const room = document.documentElement.scrollHeight - window.innerHeight
    return room > 0 ? window.scrollY / room : 0
  })))

  check(inBetween(chased) >= 20, 'the follower moved continuously rather than in a few hops', `${inBetween(chased)} distinct positions`)
  check(Math.abs(ends[1] - ends[0]) < 0.08, 'and finished where the host finished, rather than trailing for ever', `${ends[1].toFixed(3)} against ${ends[0].toFixed(3)}`)

  // The third call site, and the one that must NOT glide: a follower being PLACED on a page it has
  // just been taken to. Animating there would crawl down a page nobody has seen.
  //
  // Reaching it needs care, and an earlier version of this section did not. `pendingScroll` is
  // written in exactly one place, `land()`'s `to !== path` branch in party-sync.tsx, which runs only
  // for a `state` message. A plain `nav` navigates WITHOUT setting it, so moving the host with
  // `goto` exercises nothing at all here. A `state` that moves a guest arrives on a first join or on
  // Catch up, so Catch up from another page is the way in. The earlier version also sliced its
  // samples at the last scrollY of zero, which never occurred, leaving a one-element array that
  // `inBetween` scores 0 whatever happened: it passed unconditionally under a comment claiming it
  // covered this. Found by review, 2026-09-07.
  console.log('\nand a follower taken to a page is placed there, not walked down it')
  await host.goto(`${ORIGIN}${PAGE}`, { waitUntil: 'domcontentloaded' })
  await host.locator('.grid > .card').first().waitFor({ timeout: 45_000 }).catch(() => {})
  await until(() => guest.evaluate(() => location.pathname + location.search), where => where.startsWith('/search?'), 30_000)
  // The host waits well down the page, so the follower has a real distance to cover on arrival.
  //
  // SET AND CONFIRMED, because a `goto` to a url the page has already visited lets the browser
  // RESTORE the old scroll position, asynchronously, after our scroll has run. A run that skipped
  // this found the host at 0.41 of the page having been told to sit at 0.14, and read as the
  // follower landing in the wrong place when it was the host that had moved.
  let hostWhere = 0
  for (let attempt = 0; attempt < 5; attempt++) {
    await host.evaluate(() => { history.scrollRestoration = 'manual'; window.scrollTo({ top: Math.round(window.innerHeight * 1.5) }) })
    await host.waitForTimeout(1_000)
    hostWhere = await host.evaluate(() => window.scrollY)
    const wanted = await host.evaluate(() => Math.round(window.innerHeight * 1.5))
    if (Math.abs(hostWhere - wanted) < 40) break
  }
  check(hostWhere > 200, 'the host is parked well down the page, and stayed there', `${Math.round(hostWhere)}px`)
  await host.waitForTimeout(1_500)

  // the guest wanders off, the way a person does; a wandered guest is not dragged back until it asks
  await guest.getByRole('link', { name: 'Settings' }).click()
  const wandered = await until(() => guest.evaluate(() => location.pathname), where => where === '/settings', 20_000)
  check(wandered === '/settings', 'the follower wandered off to another page', wandered)

  // Sampled WITH the path on every frame, so the arrival is found by the navigation that actually
  // happened rather than by a scroll position that may never occur.
  await guest.evaluate(() => {
    const samples = []
    Object.assign(window, { __landing: samples })
    const tick = () => {
      samples.push({ y: window.scrollY, at: location.pathname + location.search })
      window.__landingRaf = requestAnimationFrame(tick)
    }
    window.__landingRaf = requestAnimationFrame(tick)
  })
  await guest.getByRole('button', { name: /Following/ }).click()
  await guest.getByRole('button', { name: 'Catch up' }).click()
  await until(() => guest.evaluate(() => location.pathname + location.search), where => where.startsWith('/search?'), 30_000)
  await until(() => guest.evaluate(() => window.scrollY), y => y > 200, 20_000)
  await guest.waitForTimeout(2_500)
  const landing = await guest.evaluate(() => { cancelAnimationFrame(window.__landingRaf); return window.__landing })

  const arrivedAt = landing.findIndex((sample, index) => index > 0 && sample.at !== landing[index - 1].at && sample.at.startsWith('/search?'))
  const afterArrival = arrivedAt >= 0 ? landing.slice(arrivedAt) : []
  const ys = afterArrival.map(sample => sample.y)

  check(arrivedAt >= 0, 'and Catch up navigated it back, which is the only way to reach this code', arrivedAt >= 0 ? `arrived at frame ${arrivedAt} of ${landing.length}` : 'it never navigated')
  check(afterArrival.length >= 5, 'with enough frames after the arrival to see an animation if there were one', `${afterArrival.length} frames`)
  // Compared as FRACTIONS again, and reported with both rooms, so a failure says whether the follower
  // went to the wrong place or the page it landed on simply had nowhere to go.
  const hostSpot = await host.evaluate(() => {
    const room = document.documentElement.scrollHeight - window.innerHeight
    return { fraction: room > 0 ? window.scrollY / room : 0, room }
  })
  const guestSpot = await guest.evaluate(() => {
    const room = document.documentElement.scrollHeight - window.innerHeight
    return { fraction: room > 0 ? window.scrollY / room : 0, room }
  })
  check(guestSpot.room > 400, 'the page it landed on has somewhere to go', `${Math.round(guestSpot.room)}px of room, host has ${Math.round(hostSpot.room)}px`)
  check(Math.abs(guestSpot.fraction - hostSpot.fraction) < 0.06, 'the follower ended up where the host is', `${guestSpot.fraction.toFixed(3)} against ${hostSpot.fraction.toFixed(3)}`)
  check((ys.at(-1) ?? 0) > 200, 'and that is a real distance down the page, not a rounding error', `${Math.round(ys.at(-1) ?? 0)}px`)
  check(inBetween(ys) <= 2, 'and was placed there rather than walked there', `${inBetween(ys)} in-between positions after arriving`)

  await browser.close()
}

await run()
if (failures) { console.log(`\n${failures} failed`); process.exit(1) }
console.log('\nfollowers glide, and a viewer who asked for less motion does not')
