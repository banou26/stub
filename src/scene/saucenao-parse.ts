// Pure parser for SauceNAO HTML search results (`/search.php`).
// Kept DOM-free so both the main thread and Node unit tests can run it without linkedom or regex hacks on DOM nodes.

import type { SceneError, SceneMatch, SceneMoment } from './search'

import { decodeEntities } from '../sources/entities'

/** SauceNAO documentation and live probes place reliable frame matches at 60% similarity and above. */
export const SAUCENAO_MIN_SIMILARITY = 0.6

export type SauceNaoAnswer = { matches: SceneMatch[] } | { error: SceneError }

const stripTags = (html: string): string =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

const parseTimeSeconds = (raw: string): number | null => {
  const parts = raw.trim().split(':').map(Number)
  if (parts.some(n => !Number.isFinite(n) || n < 0)) return null
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  return null
}

/**
 * Picks the canonical Stub URI from SauceNAO row links:
 * `anilist` > `mal` > `anidb` > `omdb` (for IMDb `tt` ids, since `imdb:` is a container handle whose extractor intentionally yields null).
 */
const extractUri = (block: string): { uri: string, anilist?: number } | undefined => {
  const anilist = /https?:\/\/anilist\.co\/anime\/(\d+)/i.exec(block)?.[1]
  if (anilist) return { uri: `anilist:${anilist}`, anilist: Number(anilist) }
  const mal = /https?:\/\/myanimelist\.net\/anime\/(\d+)/i.exec(block)?.[1]
  if (mal) return { uri: `mal:${mal}` }
  const anidb = /https?:\/\/anidb\.net\/(?:anime\/|perl-bin\/animedb\.pl\?show=anime&(?:amp;)?aid=)(\d+)/i.exec(block)?.[1]
  if (anidb) return { uri: `anidb:${anidb}` }
  const imdb = /https?:\/\/(?:www\.)?imdb\.com\/title\/(tt\d+)/i.exec(block)?.[1]
  if (imdb) return { uri: `omdb:${imdb}` }
  return undefined
}

const extractEpisodeInfo = (titleText: string, contentText: string): { season: number | null, episode: number | null } => {
  for (const text of [titleText, contentText]) {
    const tv = /(?:^|\s|-)S(\d{1,2})E(\d{1,3})\b/i.exec(text)
    if (tv) return { season: Number(tv[1]), episode: Number(tv[2]) }
  }
  // Anime titles on SauceNAO end with ` - <ep>` before English subtitle or release info, or carry `Episode <n>`.
  const animeDash = /\s-\s*(\d{1,4})(?:\s|$)/.exec(titleText)
  if (animeDash) return { season: null, episode: Number(animeDash[1]) }
  const episodeWord = /\bEpisode\s+(\d{1,4})\b/i.exec(`${titleText} ${contentText}`)
  if (episodeWord) return { season: null, episode: Number(episodeWord[1]) }
  return { season: null, episode: null }
}

const sameMoment = (a: SceneMoment, b: SceneMoment) =>
  (a.season ?? null) === (b.season ?? null) && a.episode === b.episode

/**
 * Parses a SauceNAO `/search.php` HTML document into ordered `SceneMatch` entries or a clean `SceneError`.
 */
export const parseSauceNaoHtml = (html: string): SauceNaoAnswer => {
  if (/Daily Search Limit Exceeded/i.test(html)) return { error: 'limit' }
  if (/Search Rate Too High|too many requests|slow down/i.test(html)) return { error: 'busy' }
  if (/cf-turnstile|challenge-platform|<title>\s*Just a moment/i.test(html)) return { error: 'busy' }
  if (/Problem with remote|error processing|invalid image|cannot determine image|You need to specify an image/i.test(html)) {
    return { error: 'failed' }
  }

  const byUri = new Map<string, SceneMatch>()
  const blocks = html.match(/<table\b[^>]*class=["'][^"']*\bresulttable\b[^"']*["'][^>]*>[\s\S]*?<\/table>/gi) ?? []

  for (const block of blocks) {
    const simRaw = /class=["'][^"']*\bresultsimilarityinfo\b[^"']*["'][^>]*>\s*(\d+(?:\.\d+)?)%/i.exec(block)?.[1]
    const similarity = simRaw ? Number(simRaw) / 100 : 0
    if (!Number.isFinite(similarity) || similarity < SAUCENAO_MIN_SIMILARITY) continue

    const ref = extractUri(block)
    if (!ref) continue

    const titleHtml = /class=["'][^"']*\bresulttitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? ''
    const contentHtml = /class=["'][^"']*\bresultcontentcolumn\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? block
    const titleText = stripTags(titleHtml)
    const contentText = stripTags(contentHtml)

    const { season, episode } = extractEpisodeInfo(titleText, contentText)
    const timeRaw = /Est Time:\s*(?:<\/strong>\s*)?(\d{1,2}:\d{2}(?::\d{2})?)/i.exec(contentHtml)?.[1]
    const from = timeRaw ? parseTimeSeconds(timeRaw) : null

    const moment: SceneMoment | undefined = from !== null
      ? { ...season !== null ? { season } : {}, episode, from }
      : undefined

    const existing = byUri.get(ref.uri)
    if (!existing) {
      byUri.set(ref.uri, {
        uri: ref.uri,
        ...ref.anilist !== undefined ? { anilist: ref.anilist } : {},
        moments: moment ? [moment] : [],
      })
      continue
    }
    if (!moment) continue
    const prior = existing.moments.find(candidate => sameMoment(candidate, moment))
    if (!prior) existing.moments.push(moment)
    else if (moment.from < prior.from) prior.from = moment.from
  }

  return { matches: [...byUri.values()] }
}
