import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'

import { expect as baseExpect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

import { builtInSources } from '../src/sources/built-in'
import { DESKTOP, firstRowTitles } from '../scripts/capture-store'
import { catalogues, english, englishIn, LANGUAGE_KEY, offerEveryLanguage, PSEUDO } from './languages'
import { workerFakes } from './worker-fakes'

// One build served under four names, as Pages serves stub.fkn.app, anime.fkn.app, movies.fkn.app and
// series.fkn.app: `*.localhost` stands in for fkn.app, and 127.0.0.1 is any other host, which shows
// everything. Built and served the way tests/title-page.spec.ts does, so JustWatch answers its four most
// popular films and shows (tests/fake-fetch.ts) and every request that leaves the server is refused. Every
// catalogue and the pseudo-language are offered (tests/languages.ts), and a browser in English gets English.

// A site draws nothing, its header included, until its worker has booted (src/worker.ts awaits it): 0.3 s idle,
// up to 3 s at a load average of 67, 13 to 17 s with the browser held to 10% of a CPU. So every check gets 30 s,
// and every test enough for six cold loads, the most one test makes
const expect = baseExpect.configure({ timeout: 30_000 })
test.describe.configure({ timeout: 180_000 })

const ROOT = join(import.meta.dirname, '..')
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}
let dir: string
let server: Server
let port: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-sites-'))
  const plugins = join(ROOT, 'src', 'plugins')
  const fetch = join(ROOT, 'src', 'utils', 'fetch')
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
    worker: { plugins: workerFakes },
    build: { outDir: dir, emptyOutDir: true },
    plugins: [offerEveryLanguage(), {
      name: 'spec-fakes',
      enforce: 'pre',
      resolveId: (source, importer) => {
        const path = importer && resolve(dirname(importer), source)
        return path === plugins ? join(ROOT, 'tests', 'fake-plugins.ts')
          : path === fetch ? join(ROOT, 'tests', 'fake-fetch.ts')
          : undefined
      },
    }],
  })

  server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://app').pathname)
    const file = join(dir, path)
    const served = !relative(dir, file).startsWith('..') && existsSync(file) && statSync(file).isFile() ? file : join(dir, 'index.html')
    response.writeHead(200, { 'content-type': TYPES[extname(served)] ?? 'application/octet-stream' })
    createReadStream(served).pipe(response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = String((server.address() as AddressInfo).port)
})

test.afterAll(async () => {
  await new Promise(resolve => server ? server.close(resolve) : resolve(undefined))
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(async ({ page }) => {
  await page.route(url => url.port !== port, route => route.abort())
})

const at = (host: string, path = '/') => `http://${host}:${port}${path}`
const row = (page: Page, title: string) => page.locator('.title', { hasText: new RegExp(`^${title}$`) })
const tab = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const cards = (page: Page, title: string) => row(page, title).locator('xpath=..').locator('a[href^="/media/"]')
// a card is two links, its picture and its title
const titles = (page: Page, title: string) =>
  cards(page, title).evaluateAll(links => [...new Set(links.map(link => link.textContent?.trim()).filter(Boolean))])

test('anime.fkn.app lists the current season alone, with no category tabs', async ({ page }) => {
  await page.goto(at('anime.localhost'))
  await expect(row(page, 'Current season')).toBeVisible()
  await expect(page.locator('a[href^="/media/"]').first()).toBeVisible()
  await expect(row(page, 'Popular movies')).toHaveCount(0)
  await expect(row(page, 'Popular shows')).toHaveCount(0)
  await expect(tab(page, 'Movies')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Search' })).toHaveAttribute('placeholder', 'Search anime…')
})

test('the header\'s site links read over a bright trailer: white with the theater title\'s dark outline', async ({ page }) => {
  await page.goto(at('anime.localhost'))
  const links = page.locator('header nav.sites a')
  await expect(links.first()).toBeVisible()
  for (const link of await links.all()) {
    const { color, shadow } = await link.evaluate(element => ({ color: getComputedStyle(element).color, shadow: getComputedStyle(element).textShadow }))
    const [r, g, b, a = 1] = color.match(/[\d.]+/g)!.map(Number)
    expect(Math.min(r!, g!, b!), `${await link.innerText()} is white, not grey`).toBe(255)
    expect(a, `${await link.innerText()} is at least three quarters opaque`).toBeGreaterThanOrEqual(0.75)
    expect(shadow.match(/rgba\(0, 0, 0, 0\.8\)/g)?.length, `${await link.innerText()} has the four-sided outline`).toBe(4)
    if (await link.getAttribute('aria-current') === 'page') expect(a, 'the current site is fully white').toBe(1)
    else expect(a, `${await link.innerText()} is dimmer than the current site`).toBeLessThan(1)
  }
})

test('movies.fkn.app lists JustWatch\'s popular films alone, with no category tabs', async ({ page }) => {
  await page.goto(at('movies.localhost'))
  await expect(row(page, 'Popular movies')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Practical Magic' }).first()).toBeVisible()
  await expect(row(page, 'Current season')).toHaveCount(0)
  await expect(row(page, 'Popular shows')).toHaveCount(0)
  await expect(tab(page, 'Movies')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Search' })).toHaveAttribute('placeholder', 'Search movies…')
})

test('movies.fkn.app draws each popular film\'s poster, and the hero shows one of them', async ({ page }) => {
  const films = ['Backrooms', 'Obsession', 'The End of Oak Street', 'Practical Magic']
  await page.goto(at('movies.localhost'))
  await expect.poll(() => page.locator('.category-item').evaluateAll(cards => cards.map(card => card.style.backgroundImage)))
    .toEqual([
      'url("https://images.justwatch.com/poster/347350367/s718/backrooms.jpg")',
      'url("https://images.justwatch.com/poster/346817191/s718/obsession-2026.jpg")',
      'url("https://images.justwatch.com/poster/347475607/s718/flowervale-street.jpg")',
      'url("https://images.justwatch.com/poster/11005490/s718/practical-magic.jpg")',
    ])
  await expect(page.locator('.theater .information > .title'), 'the hero holds THEATER_WAIT_MS for a source above JustWatch')
    .toHaveText(new RegExp(`^(${films.join('|')})$`))
})

// the hero drew JustWatch's 718x1024 poster across the screen and played nothing, as the home row asked for neither
for (const [host, fixture] of [['movies.localhost', 'popular-movies'], ['series.localhost', 'popular-shows']] as const) {
  test(`${host}'s hero plays the title's first JustWatch clip, then its backdrop once refused or on a 2G link`, async ({ page }) => {
    const titles: { title: string, backdrops: { backdropUrl: string }[], clips: { externalId: string }[] }[] =
      JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'justwatch', `${fixture}.json`), 'utf8')).data.popularTitles.edges.map(({ node }: any) => node.content)
    const shown = async () => {
      const { title, frame, style } = await page.evaluate(() => ({
        title: document.querySelector('.theater .information > .title')?.textContent,
        frame: document.querySelector('.theater iframe')?.getAttribute('src'),
        style: document.querySelector<HTMLElement>('.theater .player-wrapper')?.getAttribute('style') ?? '',
      }))
      const content = titles.find(content => content.title === title)
      return {
        content,
        clip: frame && new URL(frame).pathname.split('/').pop(),
        ownBackdrop: !!content?.backdrops.some(({ backdropUrl }) => style.includes(`images.justwatch.com${backdropUrl}`)),
      }
    }
    await page.goto(at(host))
    let picked: typeof titles[number] | undefined
    await expect.poll(async () => {
      const { content, clip } = await shown()
      picked = content
      return Boolean(clip && clip === content?.clips[0]?.externalId)
    }, { message: 'the frame is the shown title\'s first clip' }).toBe(true)
    // YouTube is refused here, so the frame fails about 10 s after it loads
    const played = new Set<string>()
    await expect.poll(async () => {
      const { content, clip, ownBackdrop } = await shown()
      if (clip) played.add(clip)
      return content === picked && !clip && ownBackdrop
    }, { message: 'the refused clip gives way to the title\'s own backdrop' }).toBe(true)
    expect([...played].filter(clip => clip !== picked?.clips[0]?.externalId), 'none of the title\'s later clips played').toEqual([])

    await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: Object.assign(new EventTarget(), { effectiveType: '2g' }) }))
    await page.goto(at(host))
    await expect.poll(async () => {
      const { clip, ownBackdrop } = await shown()
      return !clip && ownBackdrop
    }, { message: 'a title is shown over its own backdrop, with no frame' }).toBe(true)
  })
}

test('series.fkn.app lists JustWatch\'s popular shows, each a card of its own', async ({ page }) => {
  await page.goto(at('series.localhost'))
  await expect(row(page, 'Popular shows')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ted Lasso' }).first()).toBeVisible()
  await expect(row(page, 'Current season')).toHaveCount(0)
  await expect(row(page, 'Popular movies')).toHaveCount(0)
})

test.describe('on the store screenshots\' desktop page', () => {
  test.use(DESKTOP)
  for (const host of ['anime.localhost', 'movies.localhost', 'series.localhost']) {
    test(`${host} shows the first row's card titles whole`, async ({ page }) => {
      await page.goto(at(host))
      await expect(page.locator('.category-item .title-text').first()).toBeVisible()
      const { across, inView } = await page.evaluate(firstRowTitles)
      expect(across).toBeGreaterThan(0)
      expect(inView).toBe(across)
    })
  }
})

test('any other host lists all three rows under the category tabs, and a tab keeps its own row', async ({ page }) => {
  await page.goto(at('127.0.0.1'))
  for (const title of ['Current season', 'Popular movies', 'Popular shows']) await expect(row(page, title)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Practical Magic' }).first()).toBeVisible()
  await tab(page, 'Series').click()
  await expect(row(page, 'Popular shows')).toBeVisible()
  await expect(row(page, 'Popular movies')).toHaveCount(0)
})

test('movies.fkn.app\'s settings leave out the anime catalogues and their sign-ins', async ({ page }) => {
  const animeCatalogues = ['anilist', 'mal', 'kitsu', 'livechart', 'anizip', 'offline', 'cr']
  await page.goto(at('movies.localhost', '/settings#sources'))
  await expect(page.getByRole('switch', { name: / source$/ })).toHaveCount(builtInSources.length - animeCatalogues.length)
  await expect(page.getByRole('switch', { name: 'AniList source', exact: true })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'AniList icon', exact: true }), 'its icon is drawn on every site').toBeVisible()
  await expect(page.getByRole('switch', { name: 'JustWatch source', exact: true })).toBeVisible()
  await expect(page.locator('[data-account="netflix"]')).toBeVisible()
  await expect(page.locator('[data-account="prime"]')).toBeVisible()
  await expect(page.locator('[data-account="anilist"], [data-account="mal"], [data-account="crunchyroll"]')).toHaveCount(0)
})

test('search offers Category on stub alone, and Season and Format on anime and stub alone', async ({ page }) => {
  const filters = async (host: string) => {
    await page.goto(at(host, '/search'))
    await expect(page.locator('.filters .label').first()).toHaveText('Search')
    return page.locator('.filters .label').allTextContents()
  }
  expect(await filters('127.0.0.1')).toEqual(['Search', 'Genres & Tags', 'Year', 'Season', 'Format', 'Airing Status', 'Category'])
  expect(await filters('anime.localhost')).toEqual(['Search', 'Genres & Tags', 'Year', 'Season', 'Format', 'Airing Status'])
  expect(await filters('movies.localhost')).toEqual(['Search', 'Genres', 'Year'])
})

const results = (page: Page) => page.locator('.grid a.title-text').allTextContents()

test('movies.fkn.app and series.fkn.app list a genre by JustWatch\'s most popular titles of it', async ({ page }) => {
  await page.goto(at('movies.localhost', '/search?genre=Comedy'))
  await expect.poll(() => results(page)).toEqual(['Practical Magic'])
  await page.goto(at('series.localhost', '/search?genre=Sport'))
  await expect.poll(() => results(page)).toEqual(['Ted Lasso'])
})

const openPicker = async (page: Page, host: string, label: string) => {
  await page.goto(at(host, '/search'))
  await page.getByRole('combobox', { name: label, exact: true }).click()
}

test('the genre picker offers JustWatch\'s genres on movies.fkn.app and AniList\'s on anime.fkn.app', async ({ page }) => {
  await openPicker(page, 'movies.localhost', 'Genres')
  await expect(page.getByRole('option')).toHaveText([
    'Action & Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Fantasy', 'History', 'Horror',
    'Kids & Family', 'Music & Musical', 'Mystery & Thriller', 'Reality TV', 'Romance', 'Science-Fiction', 'Sport',
    'War & Military', 'Western',
  ])
  await openPicker(page, 'anime.localhost', 'Genres & Tags')
  await expect(page.getByRole('option')).toHaveText([
    'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery',
    'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
  ])
})

test('a label typed in the genre picker is offered as a tag on anime.fkn.app, and not on movies.fkn.app', async ({ page }) => {
  await openPicker(page, 'anime.localhost', 'Genres & Tags')
  await page.getByRole('textbox', { name: 'Filter genres & tags' }).fill('Isekai')
  await expect(page.getByRole('option'), 'the control: AniList may list by it').toHaveText(['Isekai'])
  await openPicker(page, 'movies.localhost', 'Genres')
  await page.getByRole('textbox', { name: 'Filter genres' }).fill('Isekai')
  await expect(page.getByText('Nothing matches “Isekai”.')).toBeVisible()
})

// Watchmode's seven hits for it: two match less closely than the film, and none carries a popularity
test('a search lists a hit with no year, no picture and no other source\'s id after every other hit', async ({ page }) => {
  await page.goto(at('127.0.0.1', '/search?q=breaking%20bad'))
  const hits = () => page.locator('.grid a.title-text').evaluateAll(links => links.map(link => link.getAttribute('href')))
  await expect.poll(async () => (await hits()).map(href => href?.includes('watchmode:011104498')))
    .toEqual([false, false, false, false, false, false, true])
})

test('a Popular row draws nothing while JustWatch is off, rather than the store\'s films and shows', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('stub.sources.disabled', '["jw"]'))
  await page.goto(at('127.0.0.1'))
  await expect(cards(page, 'Current season').first(), 'the control: the season row fills from the other sources').toBeVisible()
  await page.waitForTimeout(8_000)
  await expect(cards(page, 'Popular movies')).toHaveCount(0)
  await expect(cards(page, 'Popular shows')).toHaveCount(0)
})

// The worker has no storage of its own, so the country picked in Settings reaches its JustWatch requests only
// through the page; the fake answers The Boys as JustWatch did for the countries asked
test.describe('in Toronto', () => {
  test.use({ timezoneId: 'America/Toronto' })
  const primeLink = (page: Page) => page.locator('.origins a.origin[title="Prime Video"]')

  test('a title\'s Prime Video link is Canada\'s with no country picked', async ({ page }) => {
    await page.goto(at('127.0.0.1', '/title/jw:78125-104253'))
    await expect(primeLink(page)).toHaveAttribute('href', /^https:\/\/app\.primevideo\.com\//)
  })

  test('a title\'s Prime Video link is the UK\'s once the UK is picked in Settings', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('stub.country', 'GB'))
    await page.goto(at('127.0.0.1', '/title/jw:78125-104253'))
    await expect(primeLink(page)).toHaveAttribute('href', /^https:\/\/watch\.amazon\.co\.uk\//)
  })
})

test('a Popular row is JustWatch\'s answer in its order, also on the way back Home over a full store', async ({ page }) => {
  const films = ['Backrooms', 'Obsession', 'The End of Oak Street', 'Practical Magic']
  await page.goto(at('127.0.0.1'))
  await expect.poll(() => titles(page, 'Popular movies')).toEqual(films)
  await row(page, 'Current season').click()
  await expect(page).toHaveURL(/\/search\?/)
  await page.goBack()
  await expect(cards(page, 'Popular movies').first()).toBeVisible()
  await page.waitForTimeout(8_000)
  expect(await titles(page, 'Popular movies')).toEqual(films)
})

test('a title\'s address answers only on a site that keeps it', async ({ page }) => {
  const frieren = page.getByRole('heading', { level: 1, name: 'Frieren: Beyond Journey\'s End' })
  await page.goto(at('127.0.0.1', '/title/tmdb:209867-s1'))
  await expect(frieren, 'the control: stub keeps every title').toBeVisible()
  await page.goto(at('series.localhost', '/title/tmdb:93405-s1'))
  await expect(page.getByRole('heading', { level: 1, name: 'Squid Game' }), 'and series keeps a live-action show').toBeVisible()
  await page.goto(at('series.localhost', '/title/tmdb:209867-s1'))
  await expect(page.getByRole('textbox', { name: 'Search' }), 'the wait starts once series has drawn').toBeVisible()
  await page.waitForTimeout(8_000)
  await expect(frieren).toHaveCount(0)
})

const siteLinks = (page: Page) => page.locator('header nav').getByRole('link')
const searchField = (page: Page) => page.getByRole('textbox', { name: 'Search', exact: true })
const searchButton = (page: Page) => page.getByRole('button', { name: 'Search', exact: true })
const linkList = (page: Page) => siteLinks(page).evaluateAll(links => links.map(link => [
  link.textContent, link.getAttribute('href'), link.getAttribute('aria-current'), getComputedStyle(link).color,
]))

test('the header links the four sites in order, marks the current one, and a link lands on that site', async ({ page }) => {
  const dim = 'rgba(255, 255, 255, 0.75)'
  const white = 'rgb(255, 255, 255)'
  await page.goto(at('movies.localhost'))
  await expect(siteLinks(page)).toHaveCount(4)
  expect(await linkList(page)).toEqual([
    ['Movies', at('movies.localhost'), 'page', white],
    ['Series', at('series.localhost'), null, dim],
    ['Anime', at('anime.localhost'), null, dim],
    ['All', at('stub.localhost'), null, dim],
  ])
  await siteLinks(page).getByText('Series', { exact: true }).click()
  await expect(page).toHaveURL(at('series.localhost'))
  await expect(row(page, 'Popular shows')).toBeVisible()
  await expect(siteLinks(page).getByText('Series', { exact: true })).toHaveAttribute('aria-current', 'page')
})

test('stub.localhost marks All as the current site', async ({ page }) => {
  await page.goto(at('stub.localhost'))
  await expect(page.locator('header nav [aria-current="page"]')).toHaveText('All')
  await expect(page.locator('header nav [aria-current]')).toHaveCount(1)
})

test('any other host has no site links', async ({ page }) => {
  await page.goto(at('anime.localhost'))
  await expect(siteLinks(page), 'the control: a site\'s own host has them').toHaveCount(4)
  await page.goto(at('127.0.0.1'))
  await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible()
  await expect(siteLinks(page)).toHaveCount(0)
})

test('a site link offers this device\'s own sources to the next site, never the FKN account\'s', async ({ page }) => {
  await page.addInitScript(() => {
    if (!location.hostname.startsWith('anime.')) return
    localStorage.setItem('stub-enabled-plugins', '["https:stub.plugins.banou.dev"]')
    localStorage.setItem('stub-account-plugins', '["npm:@banou/on-the-account"]')
  })
  await page.goto(at('anime.localhost'))
  await expect(siteLinks(page).getByText('Movies', { exact: true }))
    .toHaveAttribute('href', `${at('movies.localhost')}?plugins=https:stub.plugins.banou.dev`)
})

test('from 1024 px the site links sit beside the wordmark, and a desktop keeps the search centred', async ({ page }) => {
  const searchBox = async (host: string) => {
    await page.goto(at(host))
    await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible()
    return (await page.getByRole('textbox', { name: 'Search' }).boundingBox())!
  }
  for (const width of [1024, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    const plain = await searchBox('127.0.0.1')
    const search = await searchBox('series.localhost')
    const all = (await siteLinks(page).last().boundingBox())!
    expect((await page.locator('header').boundingBox())!.height, `${width}`).toBe(70)
    expect(all.x + all.width, `${width}`).toBeLessThanOrEqual(search.x)
    expect(search.width, `${width}`).toBeGreaterThanOrEqual(300)
    if (width === 1280) {
      expect(search).toEqual(plain)
      expect(Math.abs(search.x + search.width / 2 - 640)).toBeLessThanOrEqual(1)
    }
  }
})

test('below 1024 px the bar is one row with no visible site links', async ({ page }) => {
  for (const [width, height] of [[1023, 800], [844, 390], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await page.goto(at('127.0.0.1'))
    const plain = (await page.locator('header').boundingBox())!.height
    await page.goto(at('movies.localhost'))
    const searchControl = width < 480 ? searchButton(page) : searchField(page)
    await expect(searchControl).toBeVisible()
    await expect(siteLinks(page).first(), `${width}`).toBeHidden()
    const header = (await page.locator('header').boundingBox())!
    const search = (await searchControl.boundingBox())!
    const logo = (await page.locator('header .logo').boundingBox())!
    expect(header.height, `${width}`).toBe(plain)
    if (width === 390) expect(header.height).toBe(64)
    expect(search.y, `${width}`).toBeLessThan(logo.y + logo.height)
    expect(search.y + search.height, `${width}`).toBeGreaterThan(logo.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}`).toBeLessThanOrEqual(width)
  }
})

const siteMenu = (page: Page) => page.getByRole('menu')
const pressWordmark = async (page: Page) => {
  const logo = (await page.locator('header .logo').boundingBox())!
  await page.mouse.move(logo.x + logo.width / 2, logo.y + logo.height / 2)
  await page.mouse.down()
}
const longPress = async (page: Page) => {
  await pressWordmark(page)
  await expect(siteMenu(page)).toBeVisible()
  await page.mouse.up()
}

test('a long press on the wordmark opens the four sites as a menu, with the viewer\'s sources', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('stub-enabled-plugins', '["https:stub.plugins.banou.dev"]'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(at('movies.localhost', '/settings'))
  await expect(page.locator('header .logo')).toHaveCSS('user-select', 'none')
  await longPress(page)
  const sources = '?plugins=https:stub.plugins.banou.dev'
  await expect(siteMenu(page).getByRole('link')).toHaveCount(4)
  expect(await siteMenu(page).getByRole('link').evaluateAll(links => links.map(link => [
    link.textContent, link.getAttribute('href'), link.getAttribute('aria-current'), getComputedStyle(link).color,
  ]))).toEqual([
    ['Movies', `${at('movies.localhost')}${sources}`, 'page', 'rgb(255, 255, 255)'],
    ['Series', `${at('series.localhost')}${sources}`, null, 'rgba(255, 255, 255, 0.7)'],
    ['Anime', `${at('anime.localhost')}${sources}`, null, 'rgba(255, 255, 255, 0.7)'],
    ['All', `${at('stub.localhost')}${sources}`, null, 'rgba(255, 255, 255, 0.7)'],
  ])
  await expect(page, 'the press that opened it does not also go home').toHaveURL(/\/settings/)
  await siteMenu(page).getByRole('link', { name: 'Series' }).click({ modifiers: ['Control'] })
  await expect(siteMenu(page), 'a pick closes it').toHaveCount(0)
  await expect(page).toHaveURL(/\/settings/)
  await page.locator('header .logo').click({ button: 'right' })
  await expect(siteMenu(page), 'a right click opens it too').toBeVisible()
  await page.keyboard.press('Escape')
  await expect(siteMenu(page), 'Escape closes it').toHaveCount(0)
  await page.locator('header .logo').click({ button: 'right' })
  await page.getByRole('heading', { name: 'Settings' }).click()
  await expect(siteMenu(page), 'and a click outside closes it').toHaveCount(0)
})

test('a short tap on the wordmark still goes home', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(at('movies.localhost', '/settings'))
  await longPress(page)
  await expect(siteMenu(page), 'the control: a long press opens the menu').toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('header .logo').click()
  await expect(page).toHaveURL(at('movies.localhost'))
  await expect(row(page, 'Popular movies')).toBeVisible()
  await page.waitForTimeout(800)
  await expect(siteMenu(page), 'the tap\'s own timer is cleared').toHaveCount(0)
})

test('a menu closed while its long press is still held stays closed on the release', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(at('movies.localhost', '/settings'))
  await pressWordmark(page)
  await expect(siteMenu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(siteMenu(page)).toHaveCount(0)
  await page.mouse.up()
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await expect(siteMenu(page)).toHaveCount(0)
})

test('a press that leaves the wordmark early opens nothing, and one released off it leaves Enter going home', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(at('movies.localhost', '/settings'))
  await pressWordmark(page)
  await page.mouse.move(200, 600)
  await page.waitForTimeout(800)
  await page.mouse.up()
  await expect(siteMenu(page)).toHaveCount(0)
  await pressWordmark(page)
  await expect(siteMenu(page)).toBeVisible()
  await page.mouse.move(200, 600)
  await page.mouse.up()
  await expect(siteMenu(page), 'the control: a long press opens the menu').toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('header .logo')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(at('movies.localhost'))
})

// the page stays busy 900 ms from the press, so Chrome handles the mouse release, its input, before the press's
// timer, and handles it at the same time whether it came at 50 ms or 600 ms
const busyPress = async (page: Page, hold: number) => {
  await pressWordmark(page)
  await page.evaluate(() => setTimeout(() => { for (const end = performance.now() + 900; performance.now() < end;); }))
  await page.waitForTimeout(hold)
  await page.mouse.up()
}

test('on a busy page a long press opens the menu on release, and a short tap still goes home', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(at('movies.localhost', '/settings'))
  await expect(page.locator('header .logo')).toBeVisible()
  await busyPress(page, 600)
  await expect(siteMenu(page)).toBeVisible()
  await expect(page).toHaveURL(/\/settings/)
  await page.keyboard.press('Escape')
  await busyPress(page, 50)
  await expect(page).toHaveURL(at('movies.localhost'))
  await expect(siteMenu(page)).toHaveCount(0)
})

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
  test.skip(({ browserName }) => browserName !== 'chromium')

  // page.touchscreen has only a whole tap, so the touch goes through Chrome's own input. Its release comes once the
  // press's timer has opened the menu, stamped 50 ms after the press: the order Chrome can give a short tap on a
  // busy page, from one tap in four to none in sixty four depending on load
  test('a short tap whose release comes after its timer, as on a busy page, closes the menu and goes home', async ({ page }) => {
    await page.goto(at('movies.localhost', '/settings'))
    const logo = (await page.locator('header .logo').boundingBox())!
    const touch = await page.context().newCDPSession(page)
    const pressed = Date.now() / 1000
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: logo.x + logo.width / 2, y: logo.y + logo.height / 2 }], timestamp: pressed })
    await siteMenu(page).waitFor()
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: pressed + 0.05 })
    await expect(page).toHaveURL(at('movies.localhost'))
    await expect(siteMenu(page)).toHaveCount(0)
  })
})

const sitesArrow = (page: Page) => page.getByRole('button', { name: 'Sites' })

test('below 1024 px an arrow before the wordmark opens and closes the site menu with a tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(at('movies.localhost', '/settings'))
  const arrow = (await sitesArrow(page).boundingBox())!
  const logo = (await page.locator('header .logo').boundingBox())!
  expect(arrow.x + arrow.width, 'it sits before the wordmark').toBeLessThanOrEqual(logo.x)
  await sitesArrow(page).click()
  await expect(siteMenu(page).getByRole('link')).toHaveText(['Movies', 'Series', 'Anime', 'All'])
  await expect(siteMenu(page).getByRole('link', { name: 'Movies' })).toHaveAttribute('aria-current', 'page')
  await expect(sitesArrow(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(page).toHaveURL(/\/settings/)
  await sitesArrow(page).click()
  await expect(siteMenu(page), 'a second tap closes it').toHaveCount(0)
  await sitesArrow(page).click()
  await expect(siteMenu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(siteMenu(page)).toHaveCount(0)
  await expect(sitesArrow(page), 'focus goes back to the arrow that opened it').toBeFocused()
})

test('the arrow shows only where the links are hidden, and only on the four sites', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(at('movies.localhost'))
  await expect(sitesArrow(page), 'the control: a phone on a site shows it').toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(siteLinks(page).first()).toBeVisible()
  await expect(sitesArrow(page), 'a desktop has the links inline instead').toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(at('127.0.0.1'))
  await expect(searchButton(page)).toBeVisible()
  await expect(sitesArrow(page)).toHaveCount(0)
})

test('any other host opens no menu on a long press', async ({ page }) => {
  await page.goto(at('anime.localhost'))
  await longPress(page)
  await expect(siteMenu(page), 'the control: a site\'s own host opens it').toBeVisible()
  await page.goto(at('127.0.0.1'))
  await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible()
  await expect(page.locator('header .logo')).not.toHaveCSS('user-select', 'none')
  await pressWordmark(page)
  await page.waitForTimeout(600)
  await page.mouse.up()
  await page.waitForTimeout(500)
  await expect(siteMenu(page)).toHaveCount(0)
})

test('below 480 px the search waits behind a button, and opens focused over the whole row', async ({ page }) => {
  for (const width of [360, 390, 479]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(at('movies.localhost', '/settings'))
    await expect(searchButton(page), `${width}`).toBeVisible()
    await expect(searchField(page), `${width}`).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}: no sideways scroll`).toBeLessThanOrEqual(width)
    const start = (await page.locator('header .start').boundingBox())!
    const button = (await searchButton(page).boundingBox())!
    const actions = (await page.locator('header .actions').boundingBox())!
    // the rig blocks Google Fonts, so the wordmark falls back to a font 11.3 px narrower than the live Montserrat
    // (40.7 against 52 px at 360, measured 2026-10-13): the gap here has to cover that difference
    expect(button.x - (start.x + start.width), `${width}: room between the wordmark and the button`).toBeGreaterThanOrEqual(12)
    expect(button.x + button.width, `${width}: the button ends before the actions`).toBeLessThanOrEqual(actions.x)
    await searchButton(page).click()
    await expect(searchField(page), `${width}`).toBeFocused()
    await expect(page.locator('header .actions'), `${width}: the buttons under the open field are hidden`).toBeHidden()
    expect((await searchField(page).boundingBox())!.width, `${width}: the field takes the row`).toBeGreaterThan(width - 120)
    await page.keyboard.press('Escape')
    await expect(searchField(page), `${width}: Escape closes it`).toBeHidden()
    await expect(searchButton(page)).toBeVisible()
    await expect(page.locator('header .actions')).toBeVisible()
  }
})

// HOR-1064 (a My list page): the anime site's row has room for its My list link from 600 px, and below that keeps
// the room it had without it
test('the anime site\'s My list link sits beside Settings from 600 px, and below it the row keeps its room', async ({ page }) => {
  const link = page.getByRole('link', { name: 'My list' })
  for (const width of [360, 390, 479, 599]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(at('anime.localhost', '/settings'))
    await expect(page.getByRole('link', { name: 'Settings' }), `${width}: the control, the row is drawn`).toBeVisible()
    await expect(link, `${width}`).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}: no sideways scroll`).toBeLessThanOrEqual(width)
    if (width >= 480) continue
    const start = (await page.locator('header .start').boundingBox())!
    const button = (await searchButton(page).boundingBox())!
    expect(button.x - (start.x + start.width), `${width}: room between the wordmark and the button`).toBeGreaterThanOrEqual(12)
  }
  for (const width of [600, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(at('anime.localhost', '/settings'))
    await expect(link, `${width}`).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}: no sideways scroll`).toBeLessThanOrEqual(width)
    // measured as the language test below measures a placeholder; the rig's wordmark is 11.3 px narrower than the live one
    const spare = await searchField(page).evaluate(input => {
      const style = getComputedStyle(input)
      const pen = document.createElement('canvas').getContext('2d')!
      pen.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      return input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - pen.measureText((input as HTMLInputElement).placeholder).width
    })
    expect(spare, `${width}: the search field holds its placeholder`).toBeGreaterThanOrEqual(12)
    const settings = (await page.getByRole('link', { name: 'Settings' }).boundingBox())!
    expect((await link.boundingBox())!.x, `${width}: beside Settings`).toBeLessThan(settings.x)
  }
})

test('the phone search closes on its own button or a tap away, and is open on the search page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(at('movies.localhost', '/settings'))
  await searchButton(page).click()
  await page.getByRole('button', { name: 'Close search' }).click()
  await expect(searchField(page), 'its close button closes it').toBeHidden()
  await searchButton(page).click()
  await expect(searchField(page)).toBeFocused()
  await page.getByRole('heading', { name: 'Settings' }).click()
  await expect(searchField(page), 'a tap away with nothing typed closes it').toBeHidden()
  await searchButton(page).click()
  await searchField(page).fill('dune')
  await expect(page).toHaveURL(/\/search\?/)
  await page.reload()
  await expect(searchField(page), 'the search page opens with the field shown').toHaveValue('dune')
  await searchField(page).press('Escape')
  await expect(searchField(page), 'Escape closes it with a query typed').toBeHidden()
  await searchButton(page).click()
  await expect(searchField(page)).toHaveValue('dune')
  await page.goBack()
  await expect(page).toHaveURL(/\/settings/)
  await expect(searchField(page), 'leaving the search page closes it').toBeHidden()
})

test('from 480 px the field shows as before, with no search button', async ({ page }) => {
  for (const width of [480, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(at('movies.localhost', '/settings'))
    await expect(searchField(page), `${width}`).toBeVisible()
    await expect(searchButton(page), `${width}`).toBeHidden()
  }
})

// The hero's Play asks AniList about the show it holds, and a film answered as a series leaves the Movies listing,
// so the hero picks again. Live, a category click changed the hero at most once in 40 clicks (2026-10-16)
test('a Movies click on stub changes the hero at most once', async ({ page }) => {
  const hero = page.locator('.theater .information > .title')
  await page.goto(at('stub.localhost'))
  await expect(hero).not.toBeEmpty()
  await expect(row(page, 'Popular shows')).toBeVisible()
  const shown = [(await hero.textContent())!]
  await tab(page, 'Movies').click()
  await expect(row(page, 'Popular shows'), 'the control: the click took').toHaveCount(0)
  for (const end = Date.now() + 10_000; Date.now() < end; await page.waitForTimeout(100)) {
    const title = await hero.textContent()
    if (title && title !== shown.at(-1)) shown.push(title)
  }
  expect(shown.length - 1, shown.join(' > ')).toBeLessThanOrEqual(1)
})

// HOR-1026 (stub in the viewer's language): the header's and the search page's own words, by where they are drawn
const AREA_WORDS = {
  text: [
    'header nav.sites a', '[role="menu"] a', '.heading-row .heading', '.credit', '.filters .label', '.filters .value',
    '.chips > button', '.status', '.moment', '[role="listbox"] .option span', '[role="listbox"] .empty',
  ],
  labels: [
    'header form input', 'header .search-close', 'header .search-toggle', 'header .sites-toggle', 'header .actions > a',
    '.text-field input', '.text-field .picture', '.chips > .chip', '.heading-row [role="group"]', '.heading-row [role="group"] button',
    '[role="listbox"] .filter input',
  ],
}
// a trace.moe answer for a scene search: Spec Rated's episode 1 (tests/fake-fetch.ts), as tests/scene-search.spec.ts has it
const SCENE_CODE = 'eOOEIPhB0IQhB8IQg-TPYQg-D0IQ'
const SCENE_ANSWER = {
  frameCount: 1, error: '', quota: 100, quotaUsed: 1,
  result: [{ anilist: 900040, filename: 'Spec Rated - 01.mp4', episode: 1, episode_start: 1, episode_end: 1, from: 282.3, at: 289.8, to: 292.7, similarity: 0.99 }],
}

/**
 * The area's words as drawn now, and each of them that runs past the viewport, its filter field or its own box (a filter's
 * label is as wide as its field, and a long word spills out of it), and each placeholder wider than its field, which
 * the field cuts with no scroll to show it, with each row that scrolls sideways. A summary that ends in an ellipsis is
 * cut on purpose.
 */
const drawnNow = (page: Page) => page.evaluate(({ text, labels }) => {
  const words = [
    ...text.flatMap(selector => [...document.querySelectorAll(selector)].map(element => element.textContent!.trim())),
    ...labels.flatMap(selector => [...document.querySelectorAll(selector)]
      .flatMap(element => ['aria-label', 'title', 'placeholder'].map(name => element.getAttribute(name)).filter(value => value !== null))),
  ]
  const outside = text.flatMap(selector => [...document.querySelectorAll(selector)].flatMap(element => {
    const box = element.getBoundingClientRect()
    const field = element.closest('.filters > *')?.getBoundingClientRect()
    const spills = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).textOverflow !== 'ellipsis'
    return box.width && (spills || box.left < -0.5 || box.right > innerWidth + 0.5 || (field && box.right > field.right + 0.5))
      ? [`${selector}: ${element.textContent!.trim()}`] : []
  }))
  const pen = document.createElement('canvas').getContext('2d')!
  outside.push(...labels.flatMap(selector => [...document.querySelectorAll(selector)].flatMap(input => {
    if (!(input instanceof HTMLInputElement) || !input.placeholder || input.value || !input.clientWidth) return []
    const style = getComputedStyle(input)
    pen.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    return pen.measureText(input.placeholder).width > room + 0.5 ? [`${selector}'s placeholder: ${input.placeholder}`] : []
  })))
  const scrolled = ['html', 'header', '.chips', '.heading-row', '[role="listbox"] .options'].flatMap(selector =>
    [...document.querySelectorAll(selector)].filter(element => element.scrollWidth > element.clientWidth + 1).map(() => selector))
  return { words, outside, scrolled }
}, AREA_WORDS)

/** Draws the four sites' headers, the search page's states, each of its pickers and a scene search at `width`. */
const areaDrawn = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 900 })
  const words: string[] = []
  const problems: string[] = []
  const read = async (state: string) => {
    const now = await drawnNow(page)
    words.push(...now.words)
    problems.push(...now.outside.map(text => `${state}: ${text} runs past its box`), ...now.scrolled.map(selector => `${state}: ${selector} scrolls sideways`))
  }
  for (const host of ['movies.localhost', 'series.localhost', 'anime.localhost', 'stub.localhost']) {
    await page.goto(at(host))
    await expect(page.locator('header .sites-toggle')).toBeAttached()
    await read(host)
    if (width >= 1024) continue
    await page.locator('header .sites-toggle').click()
    await expect(siteMenu(page)).toBeVisible()
    await read(`${host}'s site menu`)
    await page.keyboard.press('Escape')
  }
  await page.goto(at('stub.localhost', '/search?q=frieren&year=2026&season=FALL&status=RELEASING&category=ANIME&format=TV&format=OVA&genre=Action&genre=Science-Fiction&tag=Isekai'))
  await expect(page.locator('.status')).toBeVisible()
  await read('every filter')
  for (const path of ['/search', '/search?season=SPRING', '/search?year=2026', '/search?category=ANIME']) {
    await page.goto(at('stub.localhost', path))
    await expect(page.locator('.heading')).not.toBeEmpty()
    await read(path)
  }
  await page.goto(at('stub.localhost', '/search?genre=Action&format=TV'))
  // .all() does not wait, and before the worker boots it finds no picker at all
  const pickers = page.locator('.filters button.control')
  await expect(pickers).toHaveCount(6)
  for (const [index, control] of (await pickers.all()).entries()) {
    await control.click()
    await expect(page.getByRole('listbox')).toBeVisible()
    await read(`picker ${index}`)
    const box = page.getByRole('listbox').locator('.filter input')
    if (await box.count()) {
      await box.fill('zzzq')
      await read(`picker ${index}, nothing matching`)
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }
  await page.goto(at('movies.localhost', '/search'))
  await expect(page.locator('.status')).toBeVisible()
  await read('movies.localhost/search')
  await page.goto(at('anime.localhost', `/search?scene=${SCENE_CODE}`))
  await expect(page.locator('.moment').first()).toBeVisible()
  await read('a scene search')
  return { words, problems }
}

test.describe('the header and search in a language stub does not offer yet', () => {
  test.beforeEach(async ({ page }) => {
    for (const routes of [page, page.context()]) {
      await routes.route('https://api.trace.moe/**', route => route.fulfill({ json: SCENE_ANSWER, headers: { 'access-control-allow-origin': '*' } }))
    }
  })

  for (const language of [PSEUDO, 'de', 'ja']) {
    test(`${language}: the four sites' headers, the search page and its pickers fit at 1440 and 390 px, with none of their words in English`, async ({ page }) => {
      test.setTimeout(400_000)
      await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, language])
      const code = english()
      const translated = language === PSEUDO ? undefined : catalogues()[language]
      for (const width of [1440, 390]) {
        const { words, problems } = await areaDrawn(page, width)
        await expect(page.locator('html')).toHaveAttribute('lang', language)
        expect(problems, `${width} px`).toEqual([])
        expect(words.length, `${width} px: the control, the area's words were read`).toBeGreaterThan(200)
        expect(englishIn(words, code, translated), `${width} px`).toEqual([])
      }
    })
  }

  test('the control: in English the same reading finds the area\'s own words', async ({ page }) => {
    test.setTimeout(240_000)
    const { words } = await areaDrawn(page, 1440)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(englishIn(words, english()).length).toBeGreaterThan(150)
  })
})
