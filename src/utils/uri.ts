import { builtInSources } from '../sources/built-in'
import { groupBy } from './group-by'

export type Uri = `${string}:${string}`

type Separated<S extends string> = `${S}${''|`,${S}`}`

export type Uris = Separated<Separated<Uri>>

export type UriValues = {
  origin: string
  id: string
}

/**
 * The handle of `origin` that a source should answer about, preferring the MOST SPECIFIC one.
 *
 * This used to take the first match of a list `fromAggregatedUri` sorts by id, and a show-level id is
 * a strict PREFIX of its own season-scoped form, so the show always sorted first and always won.
 * `cr:G24H1N3MP` beat `cr:G24H1N3MP-GS00374452` in every locale, which is how the Crunchyroll source
 * came to be asked about a whole series while the correct handle for the run sat in the same cluster,
 * unreachable. It answered with every season's episodes and a 14 episode season page listed 24 rows.
 *
 * SPECIFICITY IS PREFIX EXTENSION, NOT LENGTH, and the distinction is the whole safety of this. Two
 * unrelated ids of one origin say nothing about each other however long they are, so the longer is not
 * more specific and picking it would be a different arbitrary answer rather than a better one. Only
 * `<a>` against `<a>-<something>` is a claim that the second names a part of the first, and that is
 * exactly the shape every season-scoped id in this codebase is built in: `crunchyrollId` joins on '-',
 * `jwId` and `seasonScopedId` likewise.
 *
 * TWO ids of one origin in one cluster is itself a defect and this does not fix it, it only stops the
 * defect choosing the worst of them. When neither extends the other the first still wins, which is
 * arbitrary but stable, and stability is what keeps a source answering the same way twice.
 */
const mostSpecific = (candidates: UriValues[]): UriValues | undefined => {
  let best = candidates[0]
  // the list arrives sorted by id, so a prefix always precedes what extends it and one pass suffices
  for (const candidate of candidates) {
    if (best && candidate.id.startsWith(`${best.id}-`)) best = candidate
  }
  return best
}

export const extractAggregatedUriOrigin = (uri: string, origin: string) =>
  isAggregatedUri(uri) ? mostSpecific(fromAggregatedUri(uri)?.handleUrisValues.filter(uri => uri.origin === origin) ?? [])
  : isUri(uri) && fromUri(uri).origin === origin ? fromUri(uri)
  : undefined

export const fromUri = (uri: Uri): UriValues => {
  const [origin, id] = uri.split(':') as [string, string]
  return { origin, id }
}

export const fromUris = <T extends string | undefined = undefined>(uriString: Uris, schemeSearch?: T): T extends string ? UriValues : UriValues[] => {
  const uris = uriString.split(',') as Uri[]
  const result =
    uris
      .filter(Boolean)
      .map((uri) => fromUri(uri))
  if (schemeSearch) return result.find(({ origin }) => origin === schemeSearch) as T extends string ? UriValues : UriValues[]
  return result as T extends string ? UriValues : UriValues[]
}

export const toUri = (
  { origin, id }:
  { origin: string, id: string }
): Uri => `${origin}:${id}`

export const joinUris = (uris: Uri[]) => uris.join(',') as Uris
export const splitUris = (uris: Uris) => uris.split(',') as Uri[]

export const isUri = (uri: string): uri is Uri => {
  const parts =
    uri
      .split(':')
      .filter(part => part.length)

  if (parts[1]?.includes(',')) throw new Error(`Invalid uri: ${uri}, contains "," character in id`)

  return parts.length === 2
}

// a ',' splits the handle list inside `ag:(...)` and a '/' splits ONE segment of a route path ('/watch/:mediaUri/:episodeUri'), so either one silently turns a working uri into one no route matches
const UNROUTABLE_IN_ID = /[,/()]/

export const isRoutableUri = (uri: string): boolean => {
  const colon = uri.indexOf(':')
  return colon > 0 && !UNROUTABLE_IN_ID.test(uri.slice(colon + 1))
}

export const isUris = (uri: string): uri is Uris =>
  uri
    .split(',')
    .every(isUri)

export type AggregatedUri = `ag:(${Uris})${''|`-${string}`}`

const SCANNARR_REGEX = /ag:\((.*)\)(?:-(.*))?/

export const isAggregatedUri = (uri: string): uri is AggregatedUri => {
  if (!uri?.startsWith('ag:')) return false
  const match = uri.match(SCANNARR_REGEX)
  if (!match) return false
  const uris = match?.[1]
  return !uris || isUris(uris)
}

/**
 * The routable form of a work's uri: an aggregate, even when only one source is known.
 *
 * A relation and a graph node name a work by the SOURCE that mentioned it, `anilist:166873`, because
 * that is all the naming source could say. Linking straight to it opens a page pinned to one source:
 * the store has a single row to work with, so no other source is ever asked and the page shows
 * whatever AniList alone knows. Wrapped as `ag:(anilist:166873)` it is the same work asked as a
 * CLUSTER, which is the form the store keeps resolving: it fans out to the other sources, folds in
 * whatever answers, and the modal rewrites its own address as the cluster grows.
 *
 * A uri that is already aggregated is returned untouched, and so is anything that is not a uri at all,
 * since wrapping a non-uri would produce an `ag:(...)` that no validator accepts.
 */
export const asAggregatedUri = (uri: string): string => {
  if (isAggregatedUri(uri)) return uri
  // ROUTABLE, not merely well formed. `isUri` only counts colon separated parts, so it accepts
  // `https://example.test/x` as origin `https`; wrapped, the slashes in the id would split the route
  // segment and the link would match no page at all. `isRoutableUri` is the check that asks whether
  // the id can survive being put in a path.
  if (!isRoutableUri(uri) || !isUri(uri)) return uri
  return toAggregatedUri([uri as Uri])
}

/**
 * Whether a page showing `mediaUri` should rewrite its address to it, given the address says
 * `paramsUri` and the page itself last wrote `written` there.
 *
 * The address grows as the store folds more sources into a cluster, so a page opened knowing one
 * source ends up naming all of them. Two conditions, and the second is the one that is easy to miss:
 * the cluster in hand must be BIGGER, and it must be the SAME WORK.
 *
 * An address the page wrote itself also follows the cluster down: a split takes rows out of the
 * cluster's address, and a url still naming them opens the other card on a reload. A link the reader
 * opened is never narrowed.
 *
 * Without the identity check a navigation eats itself. The address changes first and the page still
 * holds the previous work for a beat, so a link to a work known through one source is judged against
 * the old cluster's eight handles, read as a shrinking address, and replaced with the page being left.
 * Every relation and every graph node did nothing at all when clicked (measured 2026-09-09).
 */
export const shouldRewriteAddress = (mediaUri: string | undefined, paramsUri: string | undefined, written?: string): boolean => {
  if (!mediaUri || !paramsUri || mediaUri === paramsUri || !isAggregatedUri(mediaUri) || !isAggregatedUri(paramsUri)) return false
  if (!matchAggregatedUris(mediaUri, paramsUri)) return false
  if (paramsUri === written) return true
  const inHand = fromAggregatedUri(mediaUri)?.handleUris ?? []
  const named = fromAggregatedUri(paramsUri)?.handleUris ?? []
  return inHand.length > named.length
}

/**
 * A uri as it arrives in a ROUTE PARAMETER, percent-decoded once when that is what makes it a uri.
 *
 * wouter hands a path segment through undecoded, and `isUri` and `isAggregatedUri` both refuse
 * `ag%3A(...)`, so a link built with `encodeURIComponent`, or normalised by a share sheet or a chat
 * client, rendered the page's shell and then sat empty forever: the media subscription returned before
 * asking a single source, with no error anywhere (measured 2026-09-05, where it cost a session of
 * measurement against pages that were never subscribed). A segment that is already a uri, or that
 * decodes to nothing a uri validator accepts, comes back unchanged, so it reaches the same refusal it
 * always did.
 */
export const decodeRouteUri = <T extends string | undefined>(raw: T): T => {
  if (!raw || isUri(raw) || isAggregatedUri(raw)) return raw
  try {
    const decoded = decodeURIComponent(raw)
    return isUri(decoded) || isAggregatedUri(decoded) ? decoded as T : raw
  } catch {
    return raw
  }
}

/**
 * The uri a media page asks for, given its route segment: decoded, and a bare source uri, as an old bookmark or party
 * link names a work, asked as its one member cluster. A source handed a bare uri describes that id and searches
 * nothing (JustWatch, Crunchyroll, Apple TV, uNoGS), so a page asking with one never gathers what those find.
 */
export const routeMediaUri = <T extends string | undefined>(raw: T): T => {
  const uri = decodeRouteUri(raw)
  return (uri ? asAggregatedUri(uri) : uri) as T
}

export const toAggregatedUri = <T extends Uri[] | Uris>(uris: T, episode?: string) =>
  `ag:(${toAggregatedId(uris)})${episode ? `-${episode}` : ''}` as AggregatedUri

export const toAggregatedId = <T extends Uri[] | Uris>(uris: T, sort = true): string =>
  sort
    ? toAggregatedId(
      (
        fromUris(
          Array.isArray(uris)
            ? uris.join(',') as Uris
            : uris
        )
      )
        .filter(elem => elem.origin && elem.id)
        .sort((a, b) => a.id.localeCompare(b.id))
        .sort((a, b) => a.origin.localeCompare(b.origin))
        .map(toUri),
      false
    )
    : (
      encodeURI(
        Array.isArray(uris)
          ? uris.join(',')
          : uris
      )
    )

/**
 * An aggregated uri taken apart, or `undefined` when it is not one.
 *
 * ABSENT counts as not one, and that guard is load bearing rather than defensive tidiness. On a
 * browser `popstate`, `Home` re-renders BEFORE wouter's `<Switch>` does, because a browser dispatched
 * event runs a microtask checkpoint between its listeners while an app dispatched one does not. So
 * `useRoute('/media/:uri')` is already true while the surrounding params context still holds the
 * previous route's empty params, and `MediaModal` matched against `params.uri === undefined` for a
 * render or two. Dereferencing it threw mid render, and stub has no error boundary anywhere, so
 * Preact abandoned the commit and left the already mounted Home subtree ORPHANED in the DOM. The next
 * render appended a fresh copy beside it: back and forward a few times and the homepage stacked, each
 * clone's hero absolutely positioned at the same place, which is the overlapping titles the owner saw.
 */
export const fromAggregatedUri = (uri: AggregatedUri) => {
  if (typeof uri !== 'string') return undefined
  const match = uri.match(SCANNARR_REGEX)
  if (!match) return undefined
  const uris =
    fromUris(match[1] as Uris)
      .filter(elem => elem.origin && elem.id)
      .sort((a, b) => a.id.localeCompare(b.id))
      .sort((a, b) => a.origin.localeCompare(b.origin))
  return match && ({
    uri: `ag:(${joinUris(uris.map(toUri))})` as Uri,
    origin: 'ag' as const,
    id: `(${joinUris(uris.map(toUri))})`,
    handleUris: uris.map(toUri),
    handleUrisString: joinUris(uris.map(toUri)),
    handleUrisValues: uris,
    episodeId: match[2] as string
  })
}

/**
 * The origins a uri lets a source recognise itself by, deduplicated.
 *
 * One origin can contribute several handles to the same cluster, so the raw handle list repeats it.
 * What callers want is the SET, because a source is either addressable in this uri or it is not.
 */
export const originsOfUri = (uri: string): string[] => {
  if (isAggregatedUri(uri)) {
    return [...new Set(fromAggregatedUri(uri)?.handleUrisValues.map(handle => handle.origin) ?? [])]
  }
  if (isUri(uri)) return [fromUri(uri).origin]
  return []
}

const BUILT_IN_ORIGINS = new Set(builtInSources.map(source => source.origin))

/**
 * An episode's uri as a watch address names it: without the rows of added sources, which say where to watch and not
 * which episode this is. An indexer files each release as a row of the episode (28 on Frieren's second season's third
 * episode, 2026-10-31), and those rows reach only a viewer who added it, where stub's own sources answer every viewer.
 * Origin is the only test that holds: a plugin marks no release, a release's url can be a web page, and an origin
 * repeating in an episode is not one listing releases, as JustWatch files a service's row beside the service's own.
 *
 * An episode none of stub's sources knows keeps its first id, so the address still names something. Anything else comes
 * back as it came, byte for byte. Any one id in common finds the episode (`matchAggregatedUris`), so an address that
 * names every row opens as it always did, and comes out short when it is next written.
 */
export const watchEpisodeUri = (uri: string): string => {
  const handles = isAggregatedUri(uri) ? fromAggregatedUri(uri)?.handleUris ?? [] : []
  const own = handles.filter(handle => BUILT_IN_ORIGINS.has(fromUri(handle).origin))
  return own.length === handles.length ? uri : `ag:(${joinUris(own.length ? own : handles.slice(0, 1))})`
}

export const mergeAggregatedUris = (uris: AggregatedUri[]) =>
  toAggregatedUri(
    [
      ...groupBy(
        uris
          .flatMap(uri =>
            fromAggregatedUri(uri as AggregatedUri)
              ?.handleUrisValues
          ),
        uri => uri.origin
      )
    ].map(([origin, uris]) =>
      toUri(
        uris
          .sort((a, b) => b.id - a.id)
          .at(-1)
      )
    ) as unknown as Uris
  )

export const matchAggregatedUris = (uri1: AggregatedUri, uri2: AggregatedUri): boolean => {
  const parsed1 = fromAggregatedUri(uri1)
  const parsed2 = fromAggregatedUri(uri2)

  if (!parsed1 || !parsed2) return false

  return parsed1.handleUris.some(innerUri1 =>
    parsed2.handleUris.some(innerUri2 => innerUri1 === innerUri2)
  )
}

export const toUriEpisodeId = (uri: Uri, episodeId: string | number) => `${uri}-${episodeId}`
export const fromUriEpisodeId = (uri: Uri) => ({
  uri: [...(uri as string)].reverse().join('').split('-').slice(1).join('-').split('').reverse().join('') as Uri,
  episodeId: [...(uri as string)].reverse().join('').split('-').at(0)?.split('').reverse().join('') as string
})
