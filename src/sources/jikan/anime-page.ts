import { decodeEntities } from '../entities'
import { WATCHABLE, extractRealUrl } from '../justwatch/id'
import { malLargeImage } from '../mal-image'
import { genresOf, num, one, synopsisText, text } from './season-scrape'

/** A platform the page lists under Streaming Platforms. */
export type MalStreamingLink = { site: string, url: string, icon: string, country?: string }

/** One show as its myanimelist.net title page describes it. Every field but the title may be missing. */
export type MalAnime = {
  title: string
  englishTitle?: string
  japaneseTitle?: string
  cover?: string
  synopsis?: string
  /** As the page prints it: `TV`, `Movie`, `OVA`, `ONA`, `Special`, `TV Special`, `Music`. */
  type?: string
  episodes?: number
  /** `Finished Airing`, `Currently Airing` or `Not yet aired`. */
  status?: string
  startDate?: string
  endDate?: string
  /** The season it premiered in, lower case, which a film does not have. */
  season?: string
  year?: number
  score?: number
  members?: number
  genres: string[]
  /** The YouTube id of the page's promotional video. */
  trailer?: string
  /** The AniDB link the page lists under its resources. */
  anidb?: string
  streamingLinks: MalStreamingLink[]
  recommendations: MalRecommendation[]
}

/** A show the page's users recommend beside this one, with how many of them did. */
export type MalRecommendation = { id: string, title: string, cover?: string, users: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// `Apr 3, 1998`, `Oct 2027` or `2027` (title page), `Oct ??, 2027` (search). A month or a year alone stays
// `YYYY-MM` or `YYYY`, which parses to its first day, so the merge still reads it as imprecise while the
// page shows only what MAL knows; `?` and `Not available` are no date.
const airedDay = (raw?: string) => {
  const match = raw?.trim().match(/^(?:([A-Z][a-z]{2})\s+(?:(\d{1,2}|\?\?),\s*)?)?(\d{4})$/)
  if (!match) return undefined
  const [, month, day, year] = match
  if (!month) return year
  const monthNumber = MONTHS.indexOf(month) + 1
  if (!monthNumber) return undefined
  const yearMonth = `${year}-${String(monthNumber).padStart(2, '0')}`
  return Number(day) ? `${yearMonth}-${day!.padStart(2, '0')}` : yearMonth
}

/** MAL's `Aired` text, `Apr 3, 1998 to Apr 24, 1999`, as the days it starts and ends. */
export const airedDates = (aired?: string) => {
  const [from, to] = aired?.split(' to ') ?? []
  return { startDate: airedDay(from), endDate: airedDay(to) }
}

const BROADCAST = /<a href="([^"]+)"[^>]*\btitle="([^"]+)"[^>]*\bclass="broadcast-item[^>]*>\s*<img[^>]*\bsrc="([^"]+)"/g

// How JustWatch found a platform, which its click link's `cx` names in a clickout context, base64 JSON: 22 of Spirited
// Away's 31 are to rent and 3 of Cowboy Bebop's 11 to buy (mal:199 and mal:1, 2026-10-30).
const watchable = (link: string) => {
  try {
    const type = /"monetizationType":"(\w+)"/.exec(atob(new URL(link).searchParams.get('cx') ?? ''))?.[1]
    return !type || WATCHABLE.includes(type.toUpperCase())
  } catch {
    return true
  }
}

// The anchors, since a film's page carries no other form of the list. A platform JustWatch names links through
// click.justwatch.com, with its address in `r` and the country it was found in, lower case, in `uct_country`
// (mal:61578 and mal:199, 2026-10-29).
const streamingLinksOf = (html: string): MalStreamingLink[] =>
  [...html.matchAll(BROADCAST)].flatMap(([, href, site, icon]) => {
    const link = decodeEntities(href!)
    const viaJustWatch = link.startsWith('https://click.justwatch.com/')
    const url = viaJustWatch ? extractRealUrl(link) : link
    if (!url || (viaJustWatch && !watchable(link))) return []
    const country = viaJustWatch ? new URL(link).searchParams.get('uct_country')?.toUpperCase() : undefined
    return [{ site: decodeEntities(site!), url, icon: decodeEntities(icon!), ...country ? { country } : {} }]
  })

// each card links the pair, `recommendations/anime/33352-52991`, with the page's own id first or second (mal:52991,
// 2026-10-29)
const recommendationsOf = (html: string, id: string): MalRecommendation[] =>
  (one(html, /id="anime_recommendation"([\s\S]*?)<\/ul>/) ?? '').split('<li ').flatMap(card => {
    const [, a, b] = /recommendations\/anime\/(\d+)-(\d+)"/.exec(card) ?? []
    const other = a === id ? b : b === id ? a : undefined
    const title = text(one(card, /<span class="title fs10">([\s\S]*?)<\/span>/))
    const cover = one(card, /data-src="([^"]+)"/)
    return other && title
      ? [{ id: other, title, cover: cover && malLargeImage(decodeEntities(cover)), users: num(one(card, /class="users">(\d+) Users?</)) ?? 0 }]
      : []
  })

const row = (html: string, label: string) =>
  text(one(html, new RegExp(`<span class="dark_text">${label}:</span>([\\s\\S]*?)</div>`)))

/** myanimelist.net's title page for `id`, or undefined when the page names no show. */
export const parseMalAnime = (html: string, id: string): MalAnime | undefined => {
  const title = text(one(html, /<h1 class="title-name[^"]*"><strong>([\s\S]*?)<\/strong>/))
  if (!title) return undefined
  const premiered = row(html, 'Premiered')?.match(/^(Winter|Spring|Summer|Fall) (\d{4})$/)
  const anidb = one(html, /<a href="([^"]+)"[^>]*external-links-anime-pc-anidb/)
  return {
    title,
    englishTitle: row(html, 'English'),
    japaneseTitle: row(html, 'Japanese'),
    cover: malLargeImage(one(html, /<img[^>]*\bdata-src="(https:\/\/cdn\.myanimelist\.net\/images\/anime\/[^"]+)"[^>]*itemprop="image"/)),
    synopsis: synopsisText(one(html, /<p itemprop="description">([\s\S]*?)<\/p>/)),
    type: row(html, 'Type'),
    episodes: num(row(html, 'Episodes')),
    status: row(html, 'Status'),
    ...airedDates(row(html, 'Aired')),
    season: premiered?.[1]?.toLowerCase(),
    year: num(premiered?.[2]),
    score: num(one(html, /<span itemprop="ratingValue"[^>]*>([\d.]+)</)),
    members: num(row(html, 'Members')),
    // the Genres, Themes and Demographic rows are the only genre links on a title page, measured on
    // 57 pages on 2026-10-13, so the whole page reads as those three in order
    genres: genresOf(html),
    trailer: one(html, /video-promotion"><a[^>]*\/embed\/([\w-]{11})/),
    anidb: anidb && decodeEntities(anidb),
    streamingLinks: streamingLinksOf(html),
    recommendations: recommendationsOf(html, id),
  }
}
