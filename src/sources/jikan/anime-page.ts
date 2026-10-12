import { decodeEntities } from '../entities'
import { malLargeImage } from '../mal-image'
import { genresOf, num, one, synopsisText, text } from './season-scrape'

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
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// `Apr 3, 1998`, `Oct 2027` or `2027` (title page), `Oct ??, 2027` (search). A month or a year alone is
// its first day, which is how every other source here writes a partial date and what the merge reads
// as imprecise; `?` and `Not available` are no date.
const airedDay = (raw?: string) => {
  const match = raw?.trim().match(/^(?:([A-Z][a-z]{2})\s+(?:(\d{1,2}|\?\?),\s*)?)?(\d{4})$/)
  if (!match) return undefined
  const [, month, day, year] = match
  const monthNumber = month ? MONTHS.indexOf(month) + 1 : 1
  if (!monthNumber) return undefined
  return `${year}-${String(monthNumber).padStart(2, '0')}-${String(Number(day) || 1).padStart(2, '0')}`
}

/** MAL's `Aired` text, `Apr 3, 1998 to Apr 24, 1999`, as the days it starts and ends. */
export const airedDates = (aired?: string) => {
  const [from, to] = aired?.split(' to ') ?? []
  return { startDate: airedDay(from), endDate: airedDay(to) }
}

const row = (html: string, label: string) =>
  text(one(html, new RegExp(`<span class="dark_text">${label}:</span>([\\s\\S]*?)</div>`)))

/** A myanimelist.net title page, or undefined when the page names no show. */
export const parseMalAnime = (html: string): MalAnime | undefined => {
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
  }
}
