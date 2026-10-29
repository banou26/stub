// The header has to stay reachable over the media modal, so a follower in a watch party can reach the
// party pill and stop following while the host has a modal open.
//
// AND SO DOES WHAT THE HEADER OPENS, which is the half this check could not see until 2026-09-09. A
// menu is portalled to the body, so it competes at ROOT on its own number rather than inheriting the
// bar's 1100: the party menu (150), the account menu (400) and the party chat (145) all opened UNDER
// the modal, invisible through its 44% black and taking no clicks. Asserting on the header's own
// input stayed green through every one of them, which is what a check aimed at the button rather
// than the action buys you.
//
// A stacking order is not something a unit test can hold, so this drives the real page and asks the
// document what is on top, WITH A CONTROL for every row: the same measurement at the old z-index must
// fail. A check that cannot produce the failure would pass on any CSS at all.
//
// Usage:
//   npm run dev            # serves on 4560
//   node scripts/check-modal-header.mjs
//
// Run it from INSIDE the repo: an ESM script resolves bare specifiers against its own location.
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const ORIGIN = process.env.STUB_ORIGIN ?? 'http://localhost:4560'
const chrome = process.env.STUB_CHROME ?? execFileSync('which', ['google-chrome-stable'], { encoding: 'utf-8' }).trim()

const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })

let failures = 0
const check = (ok, label, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

/**
 * A page with a media modal open, and a live party when asked for one.
 *
 * The party is real, because the chat dock and the party menu do not exist without one, and the rooms
 * api behind it is the live broker. ONE party per run: the rows that need it share this page.
 */
const openModal = async ({ party = false } = {}) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  if (party) {
    await page.getByRole('button', { name: /Watch party/ }).first().click({ timeout: 60_000 })
    await page.waitForFunction(() => /Hosting/.test(document.querySelector('header')?.textContent ?? ''), null, { timeout: 60_000 })
  }
  await page.locator('a[href^="/media/"]').first().click({ timeout: 60_000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-party-scroll]').length > 0, null, { timeout: 30_000 })
  // The FKN platform parks fixed iframes at the top of the stacking order for its own surfaces. They
  // are neither the modal nor stub's, and they are not what this measures, so they are set aside;
  // without this the answer is "an FKN iframe" whatever stub's own css says.
  await page.evaluate(() => {
    for (const el of document.body.children) {
      if (el.tagName === 'IFRAME' && getComputedStyle(el).position === 'fixed') el.style.display = 'none'
    }
  })
  return page
}

/**
 * Is `selector`'s own centre the thing the document hands back at that point, and on what layer?
 *
 * `oldZ` forces the LAYER back to the number it used to carry, which is how each row earns its
 * control: the same question, answered no. The layer is found by walking up from the control to the
 * nearest ancestor that declares a z-index at all, because none of these controls carries its own:
 * the chat toggle sits in a fixed dock, and the pill's menu is the floating box around it.
 */
const onTop = (page, selector, oldZ) => page.evaluate(([selector, oldZ]) => {
  const el = document.querySelector(selector)
  if (!el) return { found: false }
  let layer = el
  while (layer && getComputedStyle(layer).zIndex === 'auto') layer = layer.parentElement
  if (oldZ !== null && layer) layer.style.zIndex = String(oldZ)
  const box = el.getBoundingClientRect()
  const hit = document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2))
  return {
    found: true,
    reachable: el === hit || el.contains(hit),
    z: layer ? getComputedStyle(layer).zIndex : 'none',
    coveredBy: el === hit || el.contains(hit) ? undefined : `z ${getComputedStyle(hit ?? document.body).zIndex}`,
  }
}, [selector, oldZ ?? null])

const modalUp = page => page.evaluate(() => document.querySelectorAll('[data-party-scroll]').length > 0)

console.log('the bar itself')
{
  const page = await openModal()
  const shipped = await onTop(page, 'header input')
  const control = await onTop(page, 'header input', 100)
  check(shipped.reachable, 'the header is reachable over the modal', `z ${shipped.z}`)
  check(!control.reachable, 'and at the old z-index 100 it is covered, so this can see a regression', control.coveredBy)
  await page.close()
}

const page = await openModal({ party: true })

console.log('\nthe party chat, which the modal used to swallow')
{
  const shipped = await onTop(page, '.toggle')
  check(shipped.found, 'the chat dock is on the page')
  check(shipped.reachable, 'the chat toggle is reachable over the modal', `z ${shipped.z}`)

  // The failure was worse than a dead button. The overlay is also the modal's own dismiss target, so
  // the click that missed the chat CLOSED the show underneath it.
  await page.locator('.toggle').click()
  await page.waitForTimeout(600)
  check(await modalUp(page), 'and clicking it does not close the modal under it')
  await page.locator('.toggle').click()
  await page.waitForTimeout(400)

  const control = await onTop(page, '.toggle', 145)
  check(!control.reachable, 'and back at 145 the overlay takes the click, so this can see a regression', control.coveredBy)
  await page.evaluate(() => {
    let layer = document.querySelector('.toggle')
    while (layer && getComputedStyle(layer).zIndex === 'auto') layer = layer.parentElement
    if (layer) layer.style.zIndex = ''
  })
}

console.log('\nthe party menu, which is the control the bar is up there for')
{
  // a CSS locator, not getByRole: FloatingFocusManager marks everything outside the modal's portal
  // aria-hidden while it is open, so the whole header is out of the accessibility tree and getByRole
  // cannot see the pill. That is a separate, older property of the modal and it already applies to
  // the pill the bar sits at 1100 for; the pointer half is what this file measures.
  await page.locator('header button').filter({ hasText: /Hosting|Following/ }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length > 0, null, { timeout: 15_000 })
  const shipped = await onTop(page, '[role="dialog"]')
  check(shipped.reachable, 'the menu behind the pill is reachable over the modal', `z ${shipped.z}`)
  check(await modalUp(page), 'and opening it does not close the modal under it')
  const control = await onTop(page, '[role="dialog"]', 150)
  check(!control.reachable, 'and back at 150 it is covered, so this can see a regression', control.coveredBy)
}

await page.close()

// The account menu is the third of the family and is NOT driven here: it only renders for a
// signed-in FKN account, which a local run does not have. Its number is pinned instead by
// tests/unit/components/chrome.test.ts, which holds the whole band against the modal's own layer.
console.log('\nnot exercised: the account menu needs a signed-in FKN session, and is pinned by the unit test instead')

await browser.close()
if (failures) { console.log(`\n${failures} failed: the modal covers something the header promises, or the check can no longer tell`); process.exit(1) }
console.log('\nthe header and everything it opens stay reachable over the media modal')
