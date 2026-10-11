// The watch party's grants across two real browser contexts on the live rooms service: the host's grid (All
// followers and one row per follower, every control a column), a grant reaching the follower as "You can", a per
// follower denial, Play for everyone moving the host, and a follower's Follow playback switch, which Catch up turns
// back on. Controls first: before a grant nothing is offered, and the host has no switch.
//
// Headless and muted: no media plays here. Run from INSIDE the repo against anime.fkn.app or a dev server:
//   STUB_ORIGIN=http://localhost:4560 node scripts/check-party-grants.mjs [screenshot.png]
//
// An address past FKN's daily volume is paced, not refused, by rooms since HOR-347, so a grant still lands in about
// 2 s; before that fix it took 18 to 38 s from such an address, which this check would show as a slow grant.
import { chromium } from 'playwright'
const ORIGIN = process.env.STUB_ORIGIN ?? 'https://anime.fkn.app'
const out = []
const log = (ok, label, detail = '') => out.push(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (read, want, timeout = 20_000) => { const end = Date.now() + timeout; let v; while (Date.now() < end) { v = await read().catch(() => undefined); if (want(v)) return v; await sleep(400) } return undefined }
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ['--mute-audio'] })
const host = await browser.newContext().then(c => c.newPage())
const guest = await browser.newContext().then(c => c.newPage())
const widget = page => page.getByRole('button', { name: /Watch together|Hosting|Following|Joining|Party/ })
const body = page => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
// the dropdown toggles on a click, so open it only when its title is not on the page
const guestMenu = async () => {
  if (!/You are following the host/.test(await body(guest))) await widget(guest).first().dispatchEvent('click')
  await sleep(150)
  return body(guest)
}

await host.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
log(Boolean(await until(() => host.locator('footer').innerText(), t => /v0\.0\.\d+/.test(t ?? ''), 30_000)), 'the app loaded')
let hosting = ''
for (let i = 0; i < 4 && !/Hosting/.test(hosting); i++) {
  await widget(host).first().click().catch(() => {})
  hosting = await until(() => widget(host).first().innerText(), t => /Hosting/.test(t ?? ''), 8_000) ?? ''
}
log(/Hosting/.test(hosting), 'the host is hosting', hosting.replace(/\s+/g, ' '))
await widget(host).first().dispatchEvent('click')
const link = await host.getByRole('textbox', { name: 'Invite link' }).inputValue()
await host.keyboard.press('Escape')

await guest.goto(link, { waitUntil: 'domcontentloaded' })
const following = await until(() => widget(guest).first().innerText(), t => /Following|Party/.test(t ?? ''), 30_000)
log(Boolean(following), 'the guest follows', (following ?? '').replace(/\s+/g, ' '))
log(!/You can/.test(await guestMenu()), 'control: before any grant, the guest is offered nothing')
const follow = guest.getByRole('switch', { name: 'Follow playback' })
log(await follow.isChecked().catch(() => false), 'the guest follows playback by default')
await follow.click().catch(() => {})
log(!(await follow.isChecked().catch(() => true)), 'the switch turns it off')
await guest.getByRole('button', { name: 'Catch up' }).click().catch(() => {})
await guestMenu()
log(await follow.isChecked().catch(() => false), 'Catch up follows playback again')
await guest.keyboard.press('Escape')

await widget(host).first().dispatchEvent('click')
const allCell = host.getByRole('button', { name: 'Play/pause, All followers' })
await allCell.waitFor({ timeout: 15_000 }).catch(() => {})
const rows = await host.locator('table th[scope="row"]').allInnerTexts().catch(() => [])
log(await host.getByRole('switch', { name: 'Follow playback' }).count() === 0, 'the host has no Follow playback switch')
log(rows.includes('All followers') && rows.length >= 2, 'the host sees All followers and one row per follower', JSON.stringify(rows))
const t0 = Date.now()
await allCell.click()
await sleep(1500)
const can = await until(() => guestMenu(), t => /You can\s*Play\/pause/.test(t ?? ''), 25_000)
log(Boolean(can), 'the grant reaches the guest', can ? `${Date.now() - t0} ms` : 'not in 25 s')

const heads = await host.locator('table thead th[title]').evaluateAll(list => list.map(th => th.getAttribute('title')))
log(JSON.stringify(heads) === JSON.stringify(['Play/pause', 'Seek', 'Episode', 'Speed']), 'the grid has Play/pause, Seek, Episode and Speed columns', JSON.stringify(heads))
await host.getByRole('button', { name: 'Seek, All followers' }).click()
const seek = await until(() => guestMenu(), t => /You can\s*Play\/pause\s*Seek/.test(t ?? ''), 15_000)
log(Boolean(seek), 'granting Seek to all followers reaches the guest too')
const guestCell = host.locator('table tr').filter({ hasNotText: 'All followers' }).locator('button.cell').first()
await guestCell.click()
log((await guestCell.getAttribute('data-grant')) === 'off', 'one click on that follower turns it off for them only', await guestCell.getAttribute('data-grant'))
const gone = await until(() => guestMenu(), t => /You can\s*Seek/.test(t ?? '') && !/Play\/pause/.test(t ?? ''), 15_000)
log(Boolean(gone), 'and the guest loses Play/pause, keeping Seek')
// Play for everyone: the guest wanders to a watch page, the button moves the host there
const WATCH = '/watch/ag:(anilist:195516)/ag:(anilist:195516-1)/anilist:195516'
log(!(await guestMenu()).includes('Play for everyone'), 'control: without the Episode grant, no Play for everyone')
await host.getByRole('button', { name: 'Episode, All followers' }).click()
// in-app navigation, as a person browsing: a reload rejoins the party and the first state moves a fresh guest to the host
await guest.evaluate(path => history.pushState(null, '', path), WATCH)
const offered = await until(() => guestMenu(), t => /Play for everyone/.test(t ?? ''), 20_000)
log(Boolean(offered), 'with Episode granted, a guest on another watch page is offered Play for everyone')
const hostBefore = new URL(host.url()).pathname
await guest.getByRole('button', { name: 'Play for everyone' }).click().catch(() => {})
const moved = await until(async () => decodeURIComponent(new URL(host.url()).pathname), p => p === decodeURIComponent(WATCH), 15_000)
log(Boolean(moved), 'one click moves the host to the guest\'s page', `${hostBefore} -> ${moved ?? decodeURIComponent(new URL(host.url()).pathname)}`)
await host.screenshot({ path: process.argv[2] ?? '/tmp/grid.png' })
console.log(out.join('\n'))
console.log(out.some(l => l.startsWith('FAIL')) ? 'FAILED' : 'all good')
await browser.close()
