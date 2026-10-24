// a regex, since scripts/check-npm-entry.mjs refuses a quoted origin-root assets path in the npm entry
const ASSET_PATH = /^\/assets\//

/** The `/assets/` files an html document loads, sorted: what names one build of stub. */
export const assetNames = (document: ParentNode): string[] =>
  [...new Set(
    [...document.querySelectorAll('script[src], link[href]')]
      .map(element => element.getAttribute('src') ?? element.getAttribute('href') ?? '')
      .filter(path => ASSET_PATH.test(path)),
  )].sort()

const isAsset = (response: Response) => response.ok && /javascript|css/.test(response.headers.get('content-type') ?? '')

/**
 * Whether `/` now serves a build naming a file that `running` lacks, with every such file downloaded,
 * so the reload onto it is served by revalidation. A file answering html is a deploy still reaching
 * this edge, since Pages answers a missing path with the app's html: that build is not ready yet.
 *
 * Only an ADDED name counts. A deploy that changes code or style always adds one, since the entry's
 * hash covers every chunk it reaches, while Vite's preload helper appends this build's own lazy
 * chunks to the head as they load, which a plain comparison would read as an update.
 */
export const newBuildReady = async (running: readonly string[]): Promise<boolean> => {
  // `/` stays outside public/_routes.json, so a check never runs the Pages Function
  const page = await fetch('/', { cache: 'no-store' })
  const added = assetNames(new DOMParser().parseFromString(await page.text(), 'text/html'))
    .filter(name => !running.includes(name))
  if (added.length === 0) return false
  const downloaded = await Promise.all(added.map(async name => {
    const response = await fetch(name)
    await response.arrayBuffer()
    return isAsset(response)
  }))
  return downloaded.every(Boolean)
}

const CHECK_MS = 15 * 60_000

/**
 * Calls `ready` once, when a newer build is downloaded. Checks every 15 minutes, when the tab comes
 * back into view, and when a lazy chunk fails to load (`vite:preloadError`), the usual sign of a
 * deploy having renamed it.
 */
export const watchBuild = (ready: () => void) => {
  let checking = false
  let found = false
  const check = async () => {
    if (checking || found) return
    checking = true
    try { found = await newBuildReady(assetNames(document)) } catch {}
    checking = false
    if (!found) return
    clearInterval(timer)
    ready()
  }
  const timer = setInterval(check, CHECK_MS)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check() })
  window.addEventListener('vite:preloadError', () => { void check() })
}
