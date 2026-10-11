// Playback sync through a source PLUGIN, across three real browser contexts and all three hops: stub's
// page, the plugin's frame (a sandbox origin), and ripple's embed inside it. A host and two followers
// open the same nyaa release through the plugin, the host's player is paused and moved from inside its
// embed frame, and the followers' embeds are read back to see them follow. Then the host hands
// Play/pause to all followers, follower A pauses, and the host and follower B have to pause with it,
// with the line in all three chats; A's pause to B's pause is logged in ms. The control runs first:
// without the grant, B never pauses and A is resumed.
//
// HEADFUL. The players stream a torrent, and a headless Chromium never gets past "Loading metadata…"
// (measured 2026-08-05), so this needs a compositor: `xvfb-run -s "-screen 0 1280x720x24"` when the
// owner is at the machine. Muted, always.
//
//   STUB_ORIGIN=http://localhost:4560 env -u WAYLAND_DISPLAY -u NIXOS_OZONE_WL \
//     xvfb-run -s "-screen 0 1280x720x24" node scripts/check-party-plugin-playback.mjs
//
// READ THE LAST LINE, NOT THE EXIT CODE, when running this under xvfb-run: that wrapper exits 1
// whatever happened (measured on this machine, see agent conventions/lessons/verification.md), so a
// run that printed `all good` still reports failure to anything gating on the status.
//
// Both contexts ACCEPT the source the link offers before anything else: a `?plugins=` url only opens
// an "Add this source?" prompt, so a run that ignores it has no plugin and no player.
//
// The plugin and ripple are the deployed ones (stub.plugins.banou.dev, torrent.fkn.app), because the
// plugin hardcodes ripple's embed origin and the package loader fetches over HTTPS. So this runs after
// those two ship, against whichever stub is named. Run it from INSIDE the repo.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const ORIGIN = process.env.STUB_ORIGIN ?? 'http://localhost:4560'
const PLUGIN = process.env.STUB_PLUGIN ?? 'https:stub.plugins.banou.dev'
// the owner's example: a nyaa release of a fall 2026 episode, played through the plugin
const WATCH = process.env.STUB_WATCH_PATH ?? '/watch/ag:(anilist:207141,anizip:19873,jw:518630-563252,kitsu:50551,mal:63403,nf:82760630-1,nyaa:19873,offline:mal-63403,tvmaze:92274-s1)/ag:(anizip:19873-5,jw:10560899,kitsu:394560,nf:82760636,nyaa:2139402,nyaa:2139482,tvmaze:3668029)/nyaa:2139402'

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

/**
 * The first reading `want` accepts, or undefined once the budget runs out.
 *
 * Undefined rather than the last reading: every caller checks the result for truth, and a last
 * reading is an object, so "the second guest paused" printed ok over `{"paused":false}` (2026-10-11).
 * The last reading is printed instead, since it is what says why.
 */
const until = async (read, want, timeout = 60_000, every = 500) => {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    // Wrapped rather than called bare: a `read` that answers synchronously (reading a url, say) has
    // no `.catch`, and this threw the moment a run first got far enough to use one.
    last = await Promise.resolve().then(read).catch(() => undefined)
    if (want(last)) return last
    await new Promise(resolve => setTimeout(resolve, every))
  }
  console.log(`  ..    gave up waiting, last read ${JSON.stringify(last)?.slice(0, 160)}`)
  return undefined
}

/** The ripple player frame inside a page, once it exists. Ripple's player route is `/watch` since 2026-09-09. */
const embedOf = page => page.frames().find(frame => /torrent\.fkn\.app\/watch/.test(frame.url()))

/** What the video in a page's embed is doing, or undefined before there is one. */
const videoOf = async page => {
  const frame = embedOf(page)
  if (!frame) return undefined
  return frame.evaluate(() => {
    const video = document.querySelector('video')
    return video ? { paused: video.paused, time: video.currentTime, ready: video.readyState } : undefined
  }).catch(() => undefined)
}

const widget = page => page.getByRole('button', { name: /Watch together|Hosting|Following|Joining|Party/ })

/**
 * Accept the source this link offers, which is what makes the plugin exist at all.
 *
 * A `?plugins=` url does not install anything: it OFFERS an invite, and stub renders "Add this
 * source?" over the page until somebody answers. A run that skipped it got a watch page with no
 * plugin, no player and nothing to sync, which reads exactly like a broken chain (2026-09-07).
 * Tolerant of the prompt being absent, since a context that already accepted will not see it.
 */
const addTheSource = async page => {
  const add = page.getByRole('button', { name: 'Add source', exact: true })
  // WAITED FOR, not counted on arrival. The prompt is rendered after the page decides the link offers
  // a source, which is a moment after the navigation resolves: a version of this that asked for the
  // count straight away always saw zero, returned "no prompt", never clicked, and left every run with
  // no plugin, no player and a `RIG BLIND` verdict about playback that had nothing to do with
  // playback (2026-09-07).
  await add.waitFor({ timeout: 30_000 }).catch(() => {})
  if (!await add.count()) return false
  await add.click()
  // gone means FKN took it; still there means it failed and the dialog says so
  await until(() => add.count(), count => count === 0, 60_000)
  return !(await add.count())
}

const run = async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: chromePath(),
    args: ['--mute-audio', '--ozone-platform=x11', '--autoplay-policy=no-user-gesture-required'],
  })
  const host = await browser.newContext().then(context => context.newPage())
  const guest = await browser.newContext().then(context => context.newPage())
  const other = await browser.newContext().then(context => context.newPage())
  for (const [name, page] of [['host', host], ['guest', guest], ['second guest', other]]) {
    page.on('pageerror', error => bad(`an uncaught page error on the ${name}`, String(error).slice(0, 160)))
  }

  console.log(`\n[party playback via plugin] ${ORIGIN} plugins=${PLUGIN}`)

  console.log('\nthe host starts a party and opens the release through the plugin')
  await host.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  await host.getByRole('button', { name: 'Watch together' }).waitFor({ timeout: 20_000 })
  let hosting = ''
  for (let attempt = 0; attempt < 4 && !/Hosting|Joining/.test(hosting); attempt++) {
    await host.getByRole('button', { name: 'Watch together' }).click().catch(() => {})
    hosting = await until(() => widget(host).innerText(), text => /Hosting|Joining/.test(text), 4_000)
  }
  hosting = await until(() => widget(host).innerText(), text => /Hosting/.test(text), 30_000)
  check(/Hosting/.test(hosting), 'the host is hosting', String(hosting).replace(/\s+/g, ' '))
  if (!/Hosting/.test(hosting)) { console.log('\nRIG BLIND: no party'); await browser.close(); process.exit(2) }
  await widget(host).dispatchEvent('click')
  const link = await host.getByRole('textbox', { name: 'Invite link' }).inputValue()
  await host.keyboard.press('Escape')

  await host.goto(`${ORIGIN}${WATCH}?plugins=${PLUGIN}`, { waitUntil: 'domcontentloaded' })
  check(await addTheSource(host), 'the host accepted the source the link offers')
  const hostVideo = await until(() => videoOf(host), video => video && video.ready >= 2, 180_000, 1_000)
  check(Boolean(hostVideo), 'the host’s embed has a video with data', JSON.stringify(hostVideo))
  if (!hostVideo) {
    // Say WHY, because "no player" has several causes that want different responses and the run knows
    // which one it hit. The chain itself is fine: driving this same release by hand on 2026-09-07 took
    // about a minute of downloading before a video element had data, and then played through
    // (agent projects/stub.md). So a bare "blind" here has sent somebody looking for a code fault that
    // was not there, twice.
    console.log('\nRIG BLIND: the host never got a player, so nothing can be synced')
    console.log(`  frames: ${JSON.stringify(host.frames().map(frame => frame.url().slice(0, 70)))}`)
    const embed = embedOf(host)
    if (!embed) console.log('  no ripple embed frame at all: the source package never mounted, so look at the plugin, not at playback')
    else {
      const said = await embed.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(error => `unreadable: ${error}`)
      console.log(`  the embed says: ${said}`)
      console.log('  "Downloading" with peers means the swarm is fine and this run simply did not wait long enough')
      console.log('  no peers, or stuck at metadata, means the swarm and not the code')
    }
    await browser.close()
    process.exit(2)
  }
  const hostPlaying = await until(() => videoOf(host), video => video && !video.paused && video.time > 1, 60_000, 1_000)
  check(Boolean(hostPlaying), 'and it is playing', JSON.stringify(hostPlaying))

  console.log('\nthe guest joins and lands on the same release')
  // THE GUEST INSTALLS THE SOURCE FIRST, which is not a detail of the rig but a fact about the
  // product: a party invite is `/party#<invite>` and carries no `?plugins=`, so a follower is never
  // offered the host's source. A follower who does not already have it gets the watch page and no
  // player at all. This check is about playback SYNC, so it puts the guest in the position of
  // somebody who already had the source, and the gap itself is recorded in agent projects/stub.md.
  await guest.goto(`${ORIGIN}${WATCH}?plugins=${PLUGIN}`, { waitUntil: 'domcontentloaded' })
  check(await addTheSource(guest), 'the guest has the source before it joins')
  await guest.goto(link, { waitUntil: 'domcontentloaded' })
  const landed = await until(() => new URL(guest.url()).pathname, path => path.startsWith('/watch/'), 60_000)
  check(landed === WATCH, 'the guest is on the host’s watch page', landed)
  // No second prompt: the source was accepted before the join, and FKN remembers it for this
  // context. One appearing here would mean the first acceptance did not take.
  const promptAgain = guest.getByRole('button', { name: 'Add source', exact: true })
  check((await promptAgain.count()) === 0, 'and needs no second prompt after joining')
  const guestVideo = await until(() => videoOf(guest), video => video && video.ready >= 2, 180_000, 1_000)
  check(Boolean(guestVideo), 'the guest’s embed has a video with data', JSON.stringify(guestVideo))
  if (!guestVideo) { console.log('\nRIG BLIND: the guest never got a player'); await browser.close(); process.exit(2) }

  console.log('\nthe host pausing and seeking moves the guest')
  // driven from INSIDE the host's embed, the way a viewer's click on the player would land
  const target = 40
  await embedOf(host).evaluate(t => { const v = document.querySelector('video'); v.pause(); v.currentTime = t }, target)
  const guestPaused = await until(() => videoOf(guest), video => video && video.paused && Math.abs(video.time - target) < 3, 30_000)
  check(Boolean(guestPaused), 'the guest paused near the host’s position', JSON.stringify(guestPaused))

  console.log('\nand the host playing again plays the guest')
  await embedOf(host).evaluate(() => document.querySelector('video').play())
  const guestPlaying = await until(() => videoOf(guest), video => video && !video.paused && video.time > target, 60_000, 1_000)
  check(Boolean(guestPlaying), 'the guest is playing, ahead of where it paused', JSON.stringify(guestPlaying))

  console.log('\na second guest joins')
  await other.goto(`${ORIGIN}${WATCH}?plugins=${PLUGIN}`, { waitUntil: 'domcontentloaded' })
  check(await addTheSource(other), 'the second guest has the source before it joins')
  await other.goto(link, { waitUntil: 'domcontentloaded' })
  const otherPlaying = await until(() => videoOf(other), video => video && !video.paused && video.time > 0, 180_000, 1_000)
  check(Boolean(otherPlaying), 'the second guest is playing with the party', JSON.stringify(otherPlaying))
  if (!otherPlaying) { console.log('\nRIG BLIND: the second guest never got a playing player'); await browser.close(); process.exit(2) }

  console.log('\nCONTROL: without the grant, a guest’s own pause moves nobody and is undone')
  const hostBefore = await videoOf(host)
  await embedOf(guest).evaluate(() => document.querySelector('video').pause())
  await new Promise(resolve => setTimeout(resolve, 3_000))
  const hostAfter = await videoOf(host)
  check(hostAfter && !hostAfter.paused && hostAfter.time > hostBefore.time, 'the host kept playing', JSON.stringify(hostAfter))
  const otherAfter = await videoOf(other)
  check(otherAfter && !otherAfter.paused, 'the second guest kept playing', JSON.stringify(otherAfter))
  const guestBack = await until(() => videoOf(guest), video => video && !video.paused, 15_000)
  check(Boolean(guestBack), 'and the guest was put back to playing', JSON.stringify(guestBack))

  console.log('\nthe host gives Play/pause to all followers, and a guest’s pause pauses the party')
  await widget(host).dispatchEvent('click')
  const cell = host.getByRole('button', { name: 'Play/pause, All followers' })
  await cell.click()
  check(await cell.getAttribute('aria-pressed') === 'true', 'the host gave Play/pause to all followers')
  await host.keyboard.press('Escape')
  // the grant reaches a follower on the next `state`, which the host sends at once
  await widget(guest).dispatchEvent('click')
  const can = await until(() => guest.getByText('Play/pause', { exact: true }).count(), count => count > 0, 10_000)
  check(can > 0, 'the guest sees it can use Play/pause')
  await guest.keyboard.press('Escape')

  const pausedAt = Date.now()
  await embedOf(guest).evaluate(() => document.querySelector('video').pause())
  const otherPaused = await until(() => videoOf(other), video => video && video.paused, 15_000, 50)
  const latency = Date.now() - pausedAt
  check(Boolean(otherPaused), 'the second guest paused', `${latency} ms after the guest's pause`)
  const hostPaused = await until(() => videoOf(host), video => video && video.paused, 5_000, 50)
  check(Boolean(hostPaused), 'the host paused', JSON.stringify(hostPaused))
  await new Promise(resolve => setTimeout(resolve, 4_000))
  const guestStill = await videoOf(guest)
  check(guestStill && guestStill.paused, 'and the guest that paused stayed paused past the ask’s hold', JSON.stringify(guestStill))
  for (const [name, page] of Object.entries({ host, guest, 'second guest': other })) {
    await page.getByRole('button', { name: 'Show chat' }).click()
    const lines = await until(() => page.locator('.line.action').allInnerTexts(), texts => texts.some(text => text.endsWith(' paused')), 10_000)
    check(Boolean(lines), `the ${name}'s chat says who paused`, JSON.stringify(lines))
  }
  console.log(`\n  latency: the guest's pause to the second guest's pause, ${latency} ms`)

  await browser.close()
  console.log(failures ? `\n${failures} failed\n` : '\nall good\n')
  process.exit(failures ? 1 : 0)
}

run().catch(error => { console.error(error); process.exit(1) })
