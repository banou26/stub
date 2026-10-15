/**
 * Retakes the store screenshots package.json's `fkn.screenshots` names, from the live sites.
 *
 *   CHROME_PATH=$(which google-chrome-stable) node scripts/capture-store.ts <dir> [shot...]
 *   cwebp -q 75 -m 6 -sharp_yuv -noalpha <dir>/<shot>-<frame>.png -o store/<shot>.webp
 *
 * Each shot opens a fresh signed-out context and waits until every picture on screen has decoded and
 * the set has held for 5 s. A home's hero plays a trailer, so a home takes a burst to pick a frame
 * from: one with no YouTube controls or text cards over the trailer and no letterbox bands.
 */
import type { BrowserContextOptions, Page } from 'playwright'

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

/** The owner's monitor: a 2560x1440 page at 1.5 (3840x2160 pixels), where the first row's card titles show. */
export const DESKTOP = { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1.5 }
export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }

const BURST = 8
const JUJUTSU_KAISEN = 'https://anime.fkn.app/title/anilist:113415'
const SHOTS: Record<string, { url: string, device: BrowserContextOptions, pictures: number, home?: true }> = {
  home: { url: 'https://anime.fkn.app/', device: DESKTOP, pictures: 6, home: true },
  title: { url: JUJUTSU_KAISEN, device: DESKTOP, pictures: 6 },
  movie: { url: 'https://movies.fkn.app/', device: DESKTOP, pictures: 6, home: true },
  series: { url: 'https://series.fkn.app/', device: DESKTOP, pictures: 6, home: true },
  search: { url: 'https://anime.fkn.app/search?q=gundam', device: DESKTOP, pictures: 12 },
  phone: { url: JUJUTSU_KAISEN, device: PHONE, pictures: 1 },
}

/** Runs in the page: the first card row's cards across the viewport, and how many of their titles lie wholly inside it. */
export const firstRowTitles = () => {
  const cards = [...document.querySelectorAll('.category-item')].map(card => ({
    card: card.getBoundingClientRect(),
    title: card.querySelector('.title-text')?.getBoundingClientRect(),
  }))
  const top = Math.min(...cards.map(({ card }) => card.top))
  const row = cards.filter(({ card }) => Math.abs(card.top - top) < 1 && card.right > 0 && card.left < innerWidth)
  return { across: row.length, inView: row.filter(({ title }) => title && title.top >= 0 && title.bottom <= innerHeight).length }
}

const picturesOnScreen = () => {
  const urls = new Set<string>()
  for (const element of document.querySelectorAll('*')) {
    const { width, height, top, bottom, left, right } = element.getBoundingClientRect()
    if (width < 8 || height < 8 || bottom <= 0 || top >= innerHeight || right <= 0 || left >= innerWidth) continue
    if (element instanceof HTMLImageElement) {
      if (element.currentSrc) urls.add(element.currentSrc)
      continue
    }
    for (const [, url] of getComputedStyle(element).backgroundImage.matchAll(/url\("?([^")]+)"?\)/g)) {
      if (url && !url.endsWith('/undefined')) urls.add(url)
    }
  }
  return [...urls]
}

const decoded = (urls: string[]) => Promise.all(urls.map(url => {
  const image = new Image()
  image.src = url
  return Promise.race([image.decode().then(() => true, () => false), new Promise<boolean>(resolve => setTimeout(resolve, 3_000, false))])
}))

const settle = async (page: Page, pictures: number) => {
  let last = ''
  let held = 0
  for (let tick = 0; tick < 120; tick++) {
    await page.waitForTimeout(1_000)
    const urls = await page.evaluate(picturesOnScreen)
    const ready = urls.length >= pictures
      && (await page.evaluate(decoded, urls)).every(Boolean)
      && await page.locator('[aria-busy="true"]').count() === 0
    const key = urls.toSorted().join('|')
    held = ready && key === last ? held + 1 : 0
    if (held >= 5) return
    last = key
  }
  throw new Error(`${page.url()} never settled`)
}

if (import.meta.main) {
  const [dir, ...names] = process.argv.slice(2)
  if (!dir) throw new Error('usage: node scripts/capture-store.ts <dir> [shot...]')
  mkdirSync(dir, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--mute-audio', '--ozone-platform=headless'] })
  for (const name of names.length ? names : Object.keys(SHOTS)) {
    const shot = SHOTS[name]
    if (!shot) throw new Error(`no shot named ${name}: ${Object.keys(SHOTS).join(', ')}`)
    const context = await browser.newContext(shot.device)
    const page = await context.newPage()
    await page.goto(shot.url)
    await settle(page, shot.pictures)
    // the platform's notices, "Free quota used" among them, sit in fkn.app's frame over the page
    for (const frame of page.frames().filter(frame => frame.parentFrame())) {
      for (const dismiss of await frame.getByRole('button', { name: 'Dismiss' }).all()) await dismiss.click()
    }
    if (shot.home) {
      const { across, inView } = await page.evaluate(firstRowTitles)
      if (!across || inView < across) throw new Error(`${name}: ${inView} of the first row's ${across} card titles are on screen`)
    }
    for (let frame = 1; frame <= (shot.home ? BURST : 1); frame++) {
      if (frame > 1) await page.waitForTimeout(2_500)
      await page.screenshot({ path: join(dir, `${name}-${frame}.png`) })
    }
    console.log(name, page.url())
    await context.close()
  }
  await browser.close()
}
