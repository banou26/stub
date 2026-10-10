// Every diagram on the site, rendered in a real browser, in both themes.
//
// A BUILD THAT SUCCEEDS PROVES NOTHING HERE. `astro-mermaid` rewrites a ```mermaid fence into a
// holder at build time and mermaid draws into it in the BROWSER, so a diagram with a syntax error
// builds perfectly and then renders as an empty box, or as mermaid's own error graphic, for every
// reader. The only check that can see that is one that loads the page and looks for the <svg>.
//
// Reads its page list from the pages the build writes, so a new page is covered the moment it exists
// rather than when someone remembers to add it here. Not from a sitemap: the site has no address, so
// Astro writes none.
//
// Resolves `playwright` by walking up to the stub repo's node_modules, which is why this file lives
// under docs/ and still runs: an ESM specifier resolves against the file's own location.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.DOCS_BASE ?? 'http://localhost:4321'

const paths = () =>
  execFileSync('find', ['dist', '-name', 'index.html'], { encoding: 'utf-8' })
    .split('\n').filter(Boolean)
    .map(file => file.replace(/^dist/, '').replace(/index\.html$/, ''))
    .sort()

// how many ```mermaid fences the SOURCE carries, per page, so a page whose diagrams silently vanished
// from the html is caught as well as one whose diagram failed to draw
const fencesBySlug = () => {
  const out = new Map()
  const files = execFileSync('find', ['src/content/docs', '-name', '*.md', '-o', '-name', '*.mdx'], { encoding: 'utf-8' })
    .split('\n').filter(Boolean)
  for (const file of files) {
    const body = readFileSync(file, 'utf-8')
    const count = (body.match(/^```mermaid\s*$/gm) ?? []).length
    const slug = file.replace(/^src\/content\/docs\//, '').replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '')
    out.set('/' + (slug ? slug + '/' : ''), count)
  }
  return out
}

const chrome = process.env.CHROME_PATH
  ?? execFileSync('which', ['google-chrome-stable'], { encoding: 'utf-8' }).trim()

const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })
const expected = fencesBySlug()
const failures = []
let drawn = 0
let checked = 0

// Every page in both themes is 120 loads on this site, and each one has to sit through mermaid's
// draw, so serially it is minutes. The pages are independent and static, so a small pool is safe.
const POOL = Number(process.env.DOCS_POOL ?? 6)
const jobs = paths().flatMap(path => ['dark', 'light'].map(theme => ({ path, theme })))
let cursor = 0

const worker = async () => {
  while (cursor < jobs.length) {
    const { path, theme } = jobs[cursor++]
    const want = expected.get(path) ?? 0
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, colorScheme: theme })
    const errors = []
    page.on('pageerror', error => errors.push(error.message.slice(0, 160)))
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    // mermaid draws after hydration; a fixed wait is enough because the whole site is static
    await page.waitForTimeout(2200)
    const seen = await page.evaluate(() => {
      const holders = [...document.querySelectorAll('.mermaid')]
      return {
        holders: holders.length,
        svgs: holders.filter(holder => holder.querySelector('svg')).length,
        // Mermaid renders its own parse failure as a PICTURE, so an <svg> alone is not success: it
        // stamps `aria-roledescription="error"` on that svg and prints "Syntax error in text".
        //
        // Do NOT test for the string `error-icon`. Mermaid inlines a <style> block carrying its error
        // icon rules into EVERY diagram it draws, including perfectly good ones, so that substring is
        // always present and a check using it reports every page as broken. Caught here by dumping a
        // diagram that had already been confirmed good by eye: 5 nodes, 5 edges, correct labels, no
        // "Syntax error" anywhere, and `error-icon` present all the same.
        broken: holders.filter(holder =>
          holder.querySelector('svg[aria-roledescription="error"]')
          || /Syntax error in text/i.test(holder.textContent ?? '')).length,
        empty: holders.filter(holder => (holder.querySelector('svg')?.querySelectorAll('*').length ?? 0) < 3).length,
        scrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        // A figure that breaks out of the text column must stop at the PANE. Running under the
        // table-of-contents rail or the nav sidebar looks like a pass to a check that only watches
        // for viewport overflow and body scroll: measured 72px of TOC overlap at 1280 and 120px at
        // 1920 while both of those stayed clean. So the rails are asserted directly.
        railOverlap: (() => {
          const toc = document.querySelector('.right-sidebar-container, .right-sidebar')
          const nav = document.querySelector('.sidebar-pane')
          const tocLeft = toc?.getBoundingClientRect().left ?? Infinity
          const navRight = nav && getComputedStyle(nav).position !== 'fixed'
            ? nav.getBoundingClientRect().right : -Infinity
          let worst = 0
          for (const holder of holders) {
            const box = holder.getBoundingClientRect()
            worst = Math.max(worst, Math.round(box.right - tocLeft), Math.round(navRight - box.left))
          }
          return worst
        })(),
      }
    })
    checked++
    if (theme === 'dark') drawn += seen.svgs
    if (seen.holders !== want) failures.push(`${path} [${theme}] has ${seen.holders} diagram holders, source has ${want} fences`)
    if (seen.svgs !== seen.holders) failures.push(`${path} [${theme}] ${seen.holders - seen.svgs} of ${seen.holders} diagrams drew no svg`)
    if (seen.broken) failures.push(`${path} [${theme}] ${seen.broken} diagram(s) rendered mermaid's syntax-error graphic`)
    if (seen.empty) failures.push(`${path} [${theme}] ${seen.empty} diagram(s) drew an empty svg`)
    if (seen.scrollsX) failures.push(`${path} [${theme}] the page scrolls horizontally; a wide diagram must scroll inside its own figure`)
    if (seen.railOverlap > 1) failures.push(`${path} [${theme}] a diagram runs ${seen.railOverlap}px under a sidebar rail`)
    if (errors.length) failures.push(`${path} [${theme}] page error: ${errors[0]}`)
    await page.close()
  }
}
await Promise.all(Array.from({ length: POOL }, worker))
await browser.close()

console.log(`${checked} page loads checked, ${drawn} diagrams drawn`)
// THE CONTROL. A run that found no diagrams at all would report zero failures and look like a pass,
// which is the single most expensive way a check like this lies.
const total = [...expected.values()].reduce((sum, n) => sum + n, 0)
if (total === 0) {
  console.error('CONTROL FAILED: the source carries no mermaid fences at all, so this run proved nothing')
  process.exit(1)
}
if (drawn === 0) {
  console.error(`CONTROL FAILED: ${total} fences in source and 0 diagrams drawn, so the check is not reading the pages`)
  process.exit(1)
}
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`)
  for (const failure of failures) console.error('  ' + failure)
  process.exit(1)
}
console.log(`every diagram drew, in both themes (${total} fences in source)`)
