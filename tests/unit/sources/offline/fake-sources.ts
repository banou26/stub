// TVmaze, ANN and AnimeThemes as the Offline history job asks them for the source store, built on their recorded
// answers. Each request is recorded as `<source> <path and query>`, and `refusing` sets a rule that answers a status
// in place of any of them.
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8')

type Show = { id: number, updated: number, [field: string]: unknown }

// shows 1 and 2 of TVmaze's show index, page 0
export const RECORDED_SHOWS = JSON.parse(read('tvmaze/show-index-page-0.json')) as Show[]
// the 3 newest titles of ANN's report
export const RECORDED_REPORT = read('ann/report-newest.xml')
// anime 1 and 2 of AnimeThemes' catalogue
export const RECORDED_CATALOGUE = JSON.parse(read('themes/animethemes-catalogue-page-1.json'))

const recordedItems = [...RECORDED_REPORT.matchAll(/<item>[\s\S]*?<\/item>/g)].map(([item]) => item)

export const tvmazeShow = (id: number, updated: number) => ({ ...RECORDED_SHOWS[0]!, id, updated })
export const annItem = (id: number, name = `Title ${id}`) => `<item><id>${id}</id><gid>${id * 7}</gid><type>TV</type><name>${name}</name><precision>TV</precision></item>`
export const anime = (id: number, slug = `anime-${id}`) => ({ ...RECORDED_CATALOGUE.data.animePagination.data[0], id, slug })

// where the updates list's `since=week` begins
const WEEK_AGO_S = Date.parse('2026-10-18T05:41:00Z') / 1000

export const fakeSources = () => {
  const asked: string[] = []
  // by id; `updated` in seconds, as TVmaze dates its shows
  const shows = new Map<number, Show>(RECORDED_SHOWS.map(show => [show.id, show]))
  // a date the updates list gives a show ahead of the copy TVmaze still serves, as its hour of caching can
  const listedAt = new Map<number, number>()
  // newest first, as ANN's report lists them
  const titles = [...recordedItems]
  const catalogue = new Map<number, object>(RECORDED_CATALOGUE.data.animePagination.data.map((entry: { id: number }) => [entry.id, entry]))
  let refuse = (_asked: string): number | undefined => undefined

  const get = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const { host, pathname, search, searchParams } = new URL(url)
    const source = { 'api.tvmaze.com': 'tvmaze', 'cdn.animenewsnetwork.com': 'ann', 'graphql.animethemes.moe': 'animethemes' }[host]
    if (!source) throw new Error(`the fake sources have no ${url}`)
    const page = source === 'animethemes' ? JSON.parse(init.body as string).variables.page : undefined
    const line = `${source} ${pathname}${search}${page ? ` page ${page}` : ''}`
    asked.push(line)
    const status = refuse(line)
    if (status) return new Response('', { status })

    if (source === 'tvmaze') {
      if (pathname === '/shows') {
        const number = Number(searchParams.get('page'))
        const listed = [...shows.values()].filter(show => Math.floor(show.id / 250) === number)
        const last = Math.max(...[...shows.keys()].map(id => Math.floor(id / 250)))
        return number > last ? Response.json({ name: 'Not Found', status: 404 }, { status: 404 }) : Response.json(listed)
      }
      if (pathname === '/updates/shows') {
        const since = searchParams.get('since') === 'week' ? WEEK_AGO_S : -Infinity
        const dates = [...shows].map(([id, show]) => [id, listedAt.get(id) ?? show.updated] as const)
        return Response.json(Object.fromEntries(dates.filter(([, at]) => at >= since)))
      }
      const show = shows.get(Number(/^\/shows\/(\d+)$/.exec(pathname)?.[1]))
      return show ? Response.json(show) : Response.json({ name: 'Not Found', status: 404 }, { status: 404 })
    }
    if (source === 'ann') {
      const nlist = searchParams.get('nlist')!
      const listed = nlist === 'all' ? titles : titles.slice(0, Number(nlist))
      return new Response(`<report skipped="0" listed="${listed.length}"><args><type>anime</type><name></name><licensed></licensed><search></search></args>\n${listed.join('\n')}</report>`, { headers: { 'content-type': 'text/xml;charset=UTF-8' } })
    }
    const all = [...catalogue.keys()].sort((a, b) => a - b).map(id => catalogue.get(id))
    return Response.json({ data: { animePagination: { paginatorInfo: { hasMorePages: all.length > page * 100 }, data: all.slice((page - 1) * 100, page * 100) } } })
  }

  return {
    asked,
    get,
    shows,
    listedAt,
    titles,
    catalogue,
    refusing: (rule: (asked: string) => number | undefined) => { refuse = rule },
  }
}
