import { expect, test } from '@playwright/test'
import preact from '@preact/preset-vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite-plus'

// Whether the host's menu fits its followers needs layout, which linkedom has none of. So this builds
// tests/party-grid.tsx with the app's JSX setup and tests/party-grid-party.ts in place of the party
// module, on a page that carries the app's global box model and type scale (src/index.tsx).

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'http://party.test'
const WATCH = '/watch/a/b'
const PAGE = '<!doctype html><html style="font-size: 62.5%"><style>*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }</style><body style="background: #0f0f0f; color: #fff; font-size: 1.6rem; font-family: sans-serif"><div id="root"></div><script type="module" src="/page.js"></script>'

let dir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-party-grid-'))
  const party = join(ROOT, 'src/party/index.ts')
  await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'error',
    plugins: [
      preact({ jsxImportSource: '@emotion/react' }),
      { name: 'party-on-the-page', load: id => id === party ? `export * from ${JSON.stringify(join(ROOT, 'tests/party-grid-party.ts'))}` : undefined },
    ],
    build: { outDir: dir, rollupOptions: { input: join(ROOT, 'tests/party-grid.tsx'), output: { entryFileNames: 'page.js' } } },
  })
})

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => route.abort())
  await page.route(`${ORIGIN}/**`, route => {
    const { pathname } = new URL(route.request().url())
    return pathname === WATCH
      ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : route.fulfill({ path: join(dir, pathname) })
  })
})

test('the host\'s grid keeps every control in view beside a follower\'s name and time', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(`${ORIGIN}${WATCH}`)
  await page.getByRole('button', { name: /Hosting/ }).click()
  const grid = page.locator('table').locator('..')
  await expect(grid.getByRole('img', { name: 'Ready' }), 'the control: the followers\' rows are drawn').toBeVisible()
  await expect(grid.getByText('1:02:05')).toHaveCount(2)
  const { inside, gaps } = await grid.evaluate(box => {
    const edge = box.getBoundingClientRect().right
    const rows = [...box.querySelectorAll('tbody tr')]
    return {
      inside: box.scrollWidth <= box.clientWidth && rows.every(row => row.lastElementChild!.getBoundingClientRect().right <= edge),
      gaps: rows.flatMap(row => {
        const time = row.querySelector('.time')
        return time ? [row.querySelector('td')!.getBoundingClientRect().left - time.getBoundingClientRect().right] : []
      }),
    }
  })
  expect(inside, 'no sideways scroll, and the last control ends inside the menu').toBe(true)
  expect(gaps).toHaveLength(2)
  for (const gap of gaps) expect(gap, 'a time stands clear of the first control').toBeGreaterThanOrEqual(4)
})
