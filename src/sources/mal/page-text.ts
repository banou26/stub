// What stub reads out of myanimelist.net's own pages. Import free and pure: bundled into the page script
// (./session-page.ts) and used by the worker (./list-api.ts) alike.

/**
 * The CSRF token MyAnimeList renders into every full page as `<meta name='csrf_token' content='...'>`
 * (single quotes, measured on about.php 2026-09-29, 40 hex characters), signed in or not. Either quote
 * is read. Undefined when the page carries none that looks like a token.
 */
export const csrfTokenOf = (html: string): string | undefined =>
  /<meta\s+name=["']csrf_token["']\s+content=["']([A-Za-z0-9]{20,})["']/.exec(html)?.[1]

/**
 * The name of the viewer MyAnimeList rendered the page for, from its `window.MAL.USER_NAME = "..."`
 * line (about.php has it with no semicolon, measured 2026-09-29). Null when the line names nobody
 * (`""`, signed out). Undefined when there is no such line, so the page is not a full MyAnimeList page.
 */
export const userNameOf = (html: string): string | null | undefined => {
  const quoted = /window\.MAL\.USER_NAME\s*=\s*("(?:[^"\\\n]|\\.)*")/.exec(html)?.[1]
  if (quoted === undefined) return undefined
  try {
    const name: unknown = JSON.parse(quoted)
    return typeof name === 'string' && name !== '' ? name : null
  } catch {
    return undefined
  }
}

/**
 * Whether a body that is NOT JSON is MyAnimeList's page for a refused client. The phrases are the ones
 * MAL-Sync reads (MyAnimeList_api/helper.ts:124-126, and the legacy single.ts:273-275 at f7495a21).
 *
 * Never asked of a JSON body: a list carries text the viewer wrote (notes, tags, titles), and a note
 * saying "request blocked" must not pause the tracker.
 */
export const isBlockPage = (text: string): boolean =>
  /Request blocked|your IP has been banned|you are not a bot/i.test(text)

/**
 * Whether a write MyAnimeList answered was accepted: a 2xx that did not end on the sign-in page. The
 * body is never read, since what a write answers was not measured; the tracker reads the list back.
 */
export const writeAccepted = (status: number, url: string): boolean =>
  status >= 200 && status < 300 && !url.includes('/login.php')
