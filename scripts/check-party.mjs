// Drives a watch-together party across two real browser contexts: a host that creates one, a guest
// that opens the invite link, and the guest following the host from page to page and down the page.
// The rooms api behind it is the live one (the broker holds the socket, so a localhost app works),
// which is also why this cannot be a unit test.
//
// Headless and MUTED. Navigation and scrolling, not a media transfer. Playback sync is NOT driven
// here: it needs a source's player, which needs a signed-in session on that source, so its logic is
// pinned in tests/unit/party/playback.test.ts and the bridge is read by hand.
//
//   npm run dev            # serves on 4560
//   node scripts/check-party.mjs
//
// A localhost origin is never bound to an app, so its rooms keep the id they were dialled under and a
// host's page load cannot show what it does on anime.fkn.app, where the invite names the room by the
// app's id. STUB_SERVE serves a local build under the live origin, every request to it answered from there:
//
//   STUB_ORIGIN=https://anime.fkn.app STUB_SERVE=http://localhost:4560 node scripts/check-party.mjs
//
// Run it from INSIDE the repo: an ESM script resolves bare specifiers against its own location.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const ORIGIN = process.env.STUB_ORIGIN ?? 'http://localhost:4560'
const SERVE = process.env.STUB_SERVE

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

const pathOf = page => { const url = new URL(page.url()); return url.pathname + url.search }

/** Poll until `read` answers something `want` accepts, or the budget runs out. Returns the last reading. */
const until = async (read, want, timeout = 20_000) => {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    last = await read()
    if (want(last)) return last
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return last
}

const widget = page => page.getByRole('button', { name: /Watch party|Hosting|Following|Joining|Party/ })

const pageIn = async browser => {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  if (SERVE) {
    await context.route(url => url.origin === ORIGIN, async route => {
      const { pathname, search } = new URL(route.request().url())
      try { await route.fulfill({ response: await route.fetch({ url: `${SERVE}${pathname}${search}` }) }) } catch { await route.abort().catch(() => {}) }
    })
  }
  return context.newPage()
}

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--mute-audio', '--ozone-platform=headless'] })
  const host = await pageIn(browser)
  const guest = await pageIn(browser)
  for (const [name, page] of [['host', host], ['guest', guest]]) {
    page.on('pageerror', error => {
      // "Failed to fetch" with no stack is the broker library's own page-side call to api.fkn.app
      // aborted by a navigation, reproduced on production's home page with no party at all
      // (2026-09-07, one round in three). Not this feature's, so it is said and not counted.
      if (/^(TypeError: )?Failed to fetch$/.test(String(error).trim())) { console.log(`  warn  a request aborted by navigation on the ${name} (the broker's, see agent projects/stub.md)`); return }
      bad(`an uncaught page error on the ${name}`, String(error).slice(0, 160))
    })
  }

  console.log(`\n[party] ${ORIGIN}${SERVE ? `, served from ${SERVE}` : ''}`)

  console.log('\nthe host starts a party')
  await host.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  await host.getByRole('button', { name: 'Watch party' }).waitFor({ timeout: 20_000 })
  // Clicked until it takes. The broker's docked bar lands a moment after the page and pushes the
  // header down, so a click issued the instant the button exists can land where it no longer is.
  let hosting = ''
  for (let attempt = 0; attempt < 4 && !/Hosting|Joining/.test(hosting); attempt++) {
    await host.getByRole('button', { name: 'Watch party' }).click().catch(() => {})
    hosting = await until(() => widget(host).innerText().catch(() => ''), text => /Hosting|Joining/.test(text), 4_000)
  }
  hosting = await until(() => widget(host).innerText().catch(() => ''), text => /Hosting/.test(text), 30_000)
  check(/Hosting/.test(hosting), 'the widget reads Hosting', hosting.replace(/\s+/g, ' '))
  if (!/Hosting/.test(hosting)) {
    console.log('\nRIG BLIND: no party was created, so nothing below can be measured')
    await browser.close()
    process.exit(2)
  }
  await widget(host).click()
  const link = await host.getByRole('textbox', { name: 'Invite link' }).inputValue()
  check(/\/party#[A-Za-z0-9_-]{43}\.(?:[\x21-\x7e]+\/)?[a-z0-9][a-z0-9._-]*$/.test(link), 'the invite is a link with the key in the fragment', link.replace(/#.*/, '#…'))
  await host.keyboard.press('Escape')

  console.log('\nthe guest opens the link and lands where the host is')
  await guest.goto(link, { waitUntil: 'domcontentloaded' })
  const landed = await until(() => pathOf(guest), path => path === '/', 30_000)
  check(landed === '/', 'the guest was moved to the host’s page', landed)
  const following = await until(() => widget(guest).innerText().catch(() => ''), text => /Following/.test(text))
  check(/Following/.test(following), 'the guest’s widget reads Following', following.replace(/\s+/g, ' '))
  const hostCount = await until(() => widget(host).innerText().catch(() => ''), text => /2/.test(text))
  check(/2/.test(hostCount), 'the host sees two in the party', hostCount.replace(/\s+/g, ' '))

  console.log('\nthe guest follows the host to a search')
  await host.goto(`${ORIGIN}/search?season=FALL&year=2026`, { waitUntil: 'domcontentloaded' })
  const followed = await until(() => pathOf(guest), path => path.startsWith('/search?'))
  check(followed === '/search?season=FALL&year=2026', 'the guest is on the same search, filters included', followed)

  console.log('\na host that loads a page from scratch, or reloads, is still the host')
  // A full load rebuilds the host's store from what the tab saved. Coming back as anyone but the
  // owner leaves a party nobody hosts: the host reads Following and the guest counts a third member.
  const settled = page => until(() => widget(page).innerText().catch(() => ''), text => /Hosting|Following/.test(text))
  const hostLoaded = await settled(host)
  check(/Hosting/.test(hostLoaded), 'after the page load the host’s widget reads Hosting', hostLoaded.replace(/\s+/g, ' '))
  await host.reload({ waitUntil: 'domcontentloaded' })
  const hostReloaded = await settled(host)
  check(/Hosting/.test(hostReloaded), 'after a reload too', hostReloaded.replace(/\s+/g, ' '))
  await new Promise(resolve => setTimeout(resolve, 2_000))
  const guestCount = (await widget(guest).innerText().catch(() => '')).replace(/\s+/g, ' ')
  check(guestCount.endsWith('Following 2'), 'and the guest still counts two: the host came back to its own seat', guestCount)

  console.log('\nand down the page')
  await host.locator('.grid > .card').first().waitFor({ timeout: 45_000 }).catch(() => {})
  await guest.locator('.grid > .card').first().waitFor({ timeout: 45_000 }).catch(() => {})
  await host.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }))
  const scrolled = await until(() => guest.evaluate(() => window.scrollY), y => y > 100, 10_000)
  check(scrolled > 100, 'the guest scrolled too', `${Math.round(scrolled)}px`)

  console.log('\na guest going its own way stays there, and comes back on Catch up')
  // A client-side move, the way a person wanders: a full load would rebuild the guest's store and
  // read as a returning follower, which is the next section.
  await guest.getByRole('link', { name: 'Settings' }).click()
  await until(() => pathOf(guest), path => path === '/settings')
  check(pathOf(guest) === '/settings', 'the guest wandered to settings', pathOf(guest))
  await new Promise(resolve => setTimeout(resolve, 12_000))
  check(pathOf(guest) === '/settings', 'and a heartbeat later is still there: a wandered guest is not yanked back', pathOf(guest))
  check(pathOf(host).startsWith('/search'), 'while the host stayed put', pathOf(host))
  await guest.getByRole('button', { name: /Following/ }).click()
  await guest.getByRole('button', { name: 'Catch up' }).click()
  const back = await until(() => pathOf(guest), path => path.startsWith('/search'))
  check(back === '/search?season=FALL&year=2026', 'Catch up brings the guest back', back)

  console.log('\nbut the host moving wins over a wandered guest')
  await guest.getByRole('link', { name: 'Settings' }).click()
  await until(() => pathOf(guest), path => path === '/settings')
  await host.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  const dragged = await until(() => pathOf(guest), path => path === '/')
  check(dragged === '/', 'the guest followed the host home', dragged)

  console.log('\na guest that reloads lands back where the party is')
  // The gap this was written for: a reload rejoins inside the api's hold, so the host hears no
  // `joined` and sends no snapshot for it. The host's heartbeat is what reaches a rebuilt store.
  await host.goto(`${ORIGIN}/search?season=FALL&year=2026`, { waitUntil: 'domcontentloaded' })
  await until(() => pathOf(guest), path => path.startsWith('/search'))
  await guest.goto(`${ORIGIN}/settings`, { waitUntil: 'domcontentloaded' })
  const returned = await until(() => pathOf(guest), path => path.startsWith('/search'), 30_000)
  check(returned === '/search?season=FALL&year=2026', 'the reloaded guest was brought back', returned)
  const stillFollowing = await until(() => widget(guest).innerText().catch(() => ''), text => /Following/.test(text))
  check(/Following/.test(stillFollowing), 'and is still following', stillFollowing.replace(/\s+/g, ' '))

  console.log('\nanyone can talk, and a name travels with a line')
  await guest.goto(`${ORIGIN}/party`, { waitUntil: 'domcontentloaded' })
  await guest.getByRole('textbox', { name: 'Your name' }).fill('Ann')
  await guest.getByRole('button', { name: 'Save' }).click()
  await guest.getByRole('button', { name: 'Show chat' }).click()
  await guest.getByRole('textbox', { name: 'Chat message' }).fill('hello from the guest')
  await guest.getByRole('button', { name: 'Send' }).click()
  const hostUnread = await until(() => host.locator('.unread').innerText().catch(() => ''), text => text === '1', 15_000)
  check(hostUnread === '1', 'the host’s bubble counts one unread', hostUnread)
  await host.getByRole('button', { name: 'Show chat' }).dispatchEvent('click')
  const hostSees = await until(() => host.locator('[aria-label="Party chat"] .line').allInnerTexts().catch(() => []), lines => lines.some(l => /hello from the guest/.test(l)), 15_000)
  check(hostSees.some(l => /Ann/.test(l) && /hello from the guest/.test(l)), 'the host reads the line under the guest’s name', JSON.stringify(hostSees))
  await host.getByRole('textbox', { name: 'Chat message' }).fill('welcome')
  await host.getByRole('button', { name: 'Send' }).dispatchEvent('click')
  const guestSees = await until(() => guest.locator('[aria-label="Party chat"] .line').allInnerTexts().catch(() => []), lines => lines.some(l => /welcome/.test(l)), 15_000)
  check(guestSees.some(l => /host/.test(l) && /welcome/.test(l)), 'the guest reads the host’s reply, labelled host', JSON.stringify(guestSees))
  check(guestSees.some(l => /you/.test(l) && /hello from the guest/.test(l)), 'and its own line once, labelled you', JSON.stringify(guestSees.filter(l => /hello from the guest/.test(l))))
  await guest.getByRole('button', { name: 'Hide chat' }).click()

  console.log('\nCONTROL: a guest cannot steer the party through the room')
  // the store refuses to send steering from a guest; the api would carry it, and the host would drop
  // it on receipt. Both halves are unit-tested; this drives the visible consequence, that the host
  // does not move when a guest walks off.
  await guest.getByRole('link', { name: 'Settings' }).click()
  await new Promise(resolve => setTimeout(resolve, 3_000))
  check(pathOf(host).startsWith('/search') || pathOf(host) === '/', 'the host is where it was', pathOf(host))

  console.log('\nthe party page lists everyone, and the host can put a guest out')
  await host.getByRole('button', { name: /Hosting/ }).dispatchEvent('click')
  await host.getByRole('button', { name: 'Party', exact: true }).dispatchEvent('click')
  await until(() => pathOf(host), path => path === '/party')
  const rows = await until(() => host.locator('[data-member]').count(), count => count === 2, 20_000)
  check(rows === 2, 'two members listed', `${rows}`)
  const guestPath = pathOf(guest)
  await new Promise(resolve => setTimeout(resolve, 2_000))
  check(pathOf(guest) === guestPath, 'the host opening the party page did not drag the guest there', pathOf(guest))
  // the host reached this page by a full load, so its store heard no introductions; the name arrives
  // with the guest's next half-minute repeat, which is what a reloaded member relies on
  const named = await until(() => host.locator('[data-member] .name').allInnerTexts(), names => names.includes('Ann'), 45_000)
  check(named.includes('Ann'), 'the guest’s name reaches the host’s roster, on the introduction heartbeat', JSON.stringify(named))
  await host.locator('[data-member]').filter({ hasNot: host.locator('.badge.you') }).getByRole('button', { name: 'Kick' }).click()
  const kicked = await until(() => widget(guest).innerText().catch(() => ''), text => /Party over/.test(text), 30_000)
  check(/Party over/.test(kicked), 'the kicked guest’s widget reads Party over', kicked.replace(/\s+/g, ' '))
  const why = await guest.locator('[role="dialog"] .title').innerText().catch(() => '')
  check(/removed/i.test(why), 'and says it was removed', why)

  console.log('\nand a kicked guest can come back')
  await guest.getByRole('button', { name: 'OK' }).click().catch(() => {})
  // A breath before going back. Opening the link the instant the removal arrived rejoined inside the
  // api's teardown of the same member id, and the second removal read as the verdict (measured
  // 2026-09-07). Nobody re-clicks an invite within the same 300 ms as being thrown out.
  await new Promise(resolve => setTimeout(resolve, 2_000))
  // Two attempts. Minutes into a party with reloads behind it, the first rejoin after a kick has
  // joined and then been removed AGAIN with no second click, about one full run in two on
  // 2026-09-07, and never in isolation. That is the api's remove-then-rejoin path, not stub's, and
  // it is recorded as such; a person would open the link again, so the check does, and says what
  // the first try read.
  let rejoined = ''
  let firstTry = ''
  for (let attempt = 0; attempt < 2 && !/Following/.test(rejoined); attempt++) {
    if (attempt) { await guest.getByRole('button', { name: 'OK' }).click().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 5_000)) }
    await guest.goto(link, { waitUntil: 'domcontentloaded' })
    rejoined = await until(() => widget(guest).innerText().catch(() => ''), text => /Following|Party over|Party failed/.test(text), 30_000)
    if (!attempt) firstTry = `${rejoined.replace(/\s+/g, ' ')} ${await guest.locator('[role="dialog"] .title').innerText().catch(() => '')}`.trim()
  }
  check(/Following/.test(rejoined), 'kicked is not banned: the guest rejoined', /Following/.test(firstTry) ? 'first try' : `second try; the first read: ${firstTry}`)

  console.log('\nCONTROL: a broken link is refused on the page, not in the broker')
  const stray = await pageIn(browser)
  await stray.goto(`${ORIGIN}/party#not-an-invite`, { waitUntil: 'domcontentloaded' })
  const broken = await until(() => stray.locator('.status').innerText().catch(() => ''), text => /broken/i.test(text))
  check(/broken/i.test(broken), 'the page says the link is broken', broken)
  await stray.close()

  console.log('\nthe host ending the party ends it for the guest')
  const guest2 = guest
  // From the party page, the host's own door, which it is already standing at, rather than through
  // the header's dialog: the broker's bar (a fixed iframe above everything) reveals itself over the
  // header for a moment after another tab is opened, and a hit-tested click then lands on the bar.
  const door = host.locator('#stub-root').getByRole('button', { name: 'End party' })
  await door.waitFor({ timeout: 30_000 })
  await door.dispatchEvent('click')
  const over = await until(() => widget(guest2).innerText().catch(() => ''), text => /Party over/.test(text), 30_000)
  check(/Party over/.test(over), 'the guest’s widget reads Party over', over.replace(/\s+/g, ' '))
  const gone = await guest2.locator('[role="dialog"] .title').innerText().catch(() => '')
  check(/host left/i.test(gone), 'and says the host left', gone)

  console.log('\nthe guest opening the ended party’s link hosts it, through a reload too')
  // The room starts again with its opener as the owner, under the id the invite names. A reload that
  // dials it any other way comes back as a newcomer, which reads Following until the api's 20 s hold
  // on the old seat runs out and then Party over, so the check waits past the hold.
  await guest2.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  await new Promise(resolve => setTimeout(resolve, 3_000))
  await guest2.goto(link, { waitUntil: 'domcontentloaded' })
  const reopened = await until(() => widget(guest2).innerText().catch(() => ''), text => /Hosting|Following|Party over|Party failed/.test(text), 30_000)
  check(/Hosting/.test(reopened), 'the guest hosts the party it reopened', reopened.replace(/\s+/g, ' '))
  await guest2.reload({ waitUntil: 'domcontentloaded' })
  await new Promise(resolve => setTimeout(resolve, 25_000))
  const held = (await widget(guest2).innerText().catch(() => '')).replace(/\s+/g, ' ')
  check(/Hosting/.test(held), 'and still does 25 s after a reload, past the seat hold', held)
  await guest2.locator('#stub-root').getByRole('button', { name: 'End party' }).dispatchEvent('click').catch(() => {})
  await until(() => widget(guest2).innerText().catch(() => ''), text => !/Hosting/.test(text), 15_000)
  // off the party page, so the next invite loads the page rather than only changing its fragment
  await guest2.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })

  console.log('\na banned guest cannot come back')
  // Last, and in a party of its own. The api blocks a guest on two keys, its seed AND its address
  // bucket, and every browser context in this rig shares one address: after a ban nothing else here
  // can join, and the host, on the same bucket, is watched for being caught by its own ban.
  await host.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  await guest2.getByRole('button', { name: 'OK' }).click().catch(() => {})
  await host.getByRole('button', { name: 'Watch party' }).waitFor({ timeout: 20_000 })
  let hosting2 = ''
  for (let attempt = 0; attempt < 4 && !/Hosting|Joining/.test(hosting2); attempt++) {
    await host.getByRole('button', { name: 'Watch party' }).click().catch(() => {})
    hosting2 = await until(() => widget(host).innerText().catch(() => ''), text => /Hosting|Joining/.test(text), 4_000)
  }
  await until(() => widget(host).innerText().catch(() => ''), text => /Hosting/.test(text), 30_000)
  await widget(host).dispatchEvent('click')
  const link2 = await host.getByRole('textbox', { name: 'Invite link' }).inputValue()
  await host.keyboard.press('Escape')
  await guest2.goto(link2, { waitUntil: 'domcontentloaded' })
  await until(() => widget(guest2).innerText().catch(() => ''), text => /Following/.test(text), 30_000)
  await host.getByRole('button', { name: /Hosting/ }).dispatchEvent('click')
  await host.getByRole('button', { name: 'Party', exact: true }).dispatchEvent('click')
  await until(() => host.locator('[data-member]').count(), count => count === 2, 20_000)
  await host.locator('[data-member]').filter({ hasNot: host.locator('.badge.you') }).getByRole('button', { name: 'Ban' }).click()
  const bannedOut = await until(() => widget(guest2).innerText().catch(() => ''), text => /Party over/.test(text), 30_000)
  check(/Party over/.test(bannedOut), 'the banned guest is out', bannedOut.replace(/\s+/g, ' '))
  await guest2.getByRole('button', { name: 'OK' }).click().catch(() => {})
  await new Promise(resolve => setTimeout(resolve, 2_000))
  await guest2.goto(link2, { waitUntil: 'domcontentloaded' })
  const refused = await until(() => widget(guest2).innerText().catch(() => ''), text => /Party failed|Following/.test(text), 30_000)
  check(/Party failed/.test(refused), 'banned: the rejoin is refused', refused.replace(/\s+/g, ' '))
  const refusedWhy = await guest2.locator('[role="dialog"] .title').innerText().catch(() => '')
  check(/cannot join/i.test(refusedWhy), 'and says so', refusedWhy)
  await new Promise(resolve => setTimeout(resolve, 8_000))
  const hostAfterBan = await widget(host).innerText().catch(() => '')
  check(/Hosting/.test(hostAfterBan), 'the host, on the same address bucket, is not caught by its own ban', hostAfterBan.replace(/\s+/g, ' '))

  await browser.close()
  console.log(failures ? `\n${failures} failed\n` : '\nall good\n')
  process.exit(failures ? 1 : 0)
}

run().catch(error => { console.error(error); process.exit(1) })
