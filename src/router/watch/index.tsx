import type { RouteParams } from '../path'
import type { WatchSource } from '../../components/source-selector'

import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'
import { useSubscription } from 'urql'
import { Link, useLocation, useParams, useSearch } from 'wouter'

import { remoteAccount, remotePicker, remotePlayer } from '../../worker'

import { OriginFilter } from '../../generated/graphql'
import { gql } from '../../generated'
import { pluginAccounts } from '../../plugin-accounts'
import { builtInSources } from '../../sources/built-in'
import { crunchyrollEpisodeId, skipEventsToChapters, useSkipEvents } from '../../sources/crunchyroll/skip-events'
import { readDisabledSources } from '../../sources/disabled-sources'
import { canPlay, EXTENSION_ONLY_ORIGINS, PLAYABLE_ORIGINS } from '../../sources/playable'
import { playOrder, readPlayOrder } from '../../sources/play-order'
import { addExtension, canAddExtension, detectBackend, type FknBackend } from '../../utils/fkn-backend'
import SourceSelector from '../../components/source-selector'
import PluginPlayer from '../../components/plugin-player'
import PartyPlayback from '../../components/party-playback'
import Placeholder from '../../components/placeholder'
import ShareButton from '../../components/share-button'
import MediaTracking from '../../components/media-tracking'
import MediaSeasons from '../../components/media-seasons'
import { attachPlaybackBridge, type PlaybackLink } from '../../party/bridge'
import { useParty } from '../../party/use-party'
import { hearTrackLanguages, trackLanguagesParams } from '../../embed-languages'
import { hearTriedRelays, triedRelaysParams } from '../../embed-relays'
import { hearUnplayable } from '../../embed-unplayable'
import { serveEmbedTitle } from '../../embed-title'
import { embedTracks, type TracksLink } from '../../embed-tracks'
import { episodeLabel } from '../../utils/episode-label'
import { useNow } from '../../utils/use-now'
import { usePluginStatuses } from '../../utils/use-plugin-statuses'
import { AggregatedUri, asAggregatedUri, fromAggregatedUri, fromUri, matchAggregatedUris, decodeRouteUri, routeMediaUri } from '../../utils/uri'
import { Episodes, EpisodesPlaceholder, useTrackingSummary } from '../home/media-details'
import { currentMedia } from '../home/modal-media'
import { isMovieMedia } from '../home/movie'
import { getRoutePath, Route } from '../path'
import { foundSignedIn, neverSignedIn as neverSignedInTo, offersSignIn } from '../settings/accounts'
import { crunchyroll, prime, sites, status } from '../settings/wiring'
import { bestSource, playPick, useAutoPick, type Ways } from './auto-pick'
import { adjacentRun, neighbours, sourceFor } from './neighbours'
import NoSource from './no-source'
import { startOf, useResume } from './resume'
import UpNext from './up-next'

/**
 * The episode rows this episode claims to BE, unwrapped from their edges.
 *
 * Everything on this page routes into PLAYBACK: a uri picked here is handed to the player and to the
 * embed. A node that is only PART_OF this episode would play a different one, so it is filtered out
 * rather than merely unhandled. No source emits a PART_OF episode handle today; the filter is here so
 * that the day one does it shows up as a missing row rather than a wrong stream.
 */
const playableHandlesOf = <T extends { relation: string, node: unknown }>(handles: T[] | undefined) =>
  (handles ?? []).filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node as T['node'])

// A source the address names but this session has not matched to the episode (a shared link, or the
// reload a click used to be) still plays when its watch url follows from its id.
const WATCH_URLS: Record<string, (id: string) => string> = { nf: id => `https://www.netflix.com/watch/${id}` }

const GET_WATCH_MEDIA = gql(`
  subscription GetWatchMedia($input: MediaInput!) {
    media(input: $input) {
      _id
      uri
      origin
      id
      titles {
        title
      }
      covers {
        url
      }
      type
      categories
      episodeCount
      status
      settled
      nextAiringEpisode {
        episodeNumber
        airingAt
      }
      airingSchedule {
        episodeNumber
        airingAt
      }
      seasons {
        number
        uri
      }
      relations {
        relation
        format
        node {
          _id
          uri
        }
      }
      episodes {
        ...EpisodeFragment
        episodeNumber
        releaseDate
        titles {
          title
        }
        shortDescriptions {
          language
          shortDescription
        }
        thumbnails {
          url
        }
        handles {
          relation
          node {
            _id
            uri
            origin
            id
            url
            embedUrl
            mediaUri
            episodeNumber
            releaseDate
            titles {
              title
            }
            shortDescriptions {
              language
              shortDescription
            }
            thumbnails {
              url
            }
            videoQualities
            audioQualities
            audioLanguages
            subtitleLanguages
          }
        }
      }
      handles {
        relation
        node {
          ...MediaFragment
          handles {
            relation
            node {
              ...MediaFragment
              episodes {
                ...EpisodeFragment
              }
            }
          }
          episodes {
            ...EpisodeFragment
            episodeNumber
          }
        }
      }
    }
  }
`)

const GET_WATCH_ORIGINS = gql(`
  subscription GetWatchOrigins($input: OriginPageInput!) {
    originPage(input: $input) {
      nodes {
        id
        url
        name
        icon
        color
        isApiOnly
      }
    }
  }
`)

/** The run of episodes beside the one playing, while `uri` names it. */
const useRun = (uri: string | undefined) => {
  const [state] = useSubscription({ query: GET_WATCH_MEDIA, variables: { input: { uri: uri ?? '' } }, pause: !uri })
  return currentMedia(state, uri)
}

const style = css`
  display: flex;
  flex-direction: column;
  /* The bar is fixed, so it takes no room in the flow and every other route pads itself out from
     under it. This one has to as well: without the reservation the header floats over the top strip
     of the player, which is exactly where the source puts its own title and controls. */
  padding-top: var(--stub-header-height);
  color: rgb(255, 255, 255);

  /* The player and the episode's row fill the first screen, the player giving up height to the row
     rather than going past 16:9, and the sources follow below, so a source never takes its height from
     the video. Not on a window too short to keep 20rem of player above the row, where the row would
     spill over the sources. */
  .watch-container {
    display: flex;
    flex-direction: column;

    @media (min-height: 600px) {
      max-height: calc(100vh - var(--stub-header-height));
    }
  }

  .player-container {
    position: relative;
    display: flex;
    flex-direction: column;
    /* Firefox otherwise takes the width from the ratio and the column's height before the column
       shrinks it, 1838 of 2000 px (Firefox 157, 2026-10-26) */
    width: 100%;
    aspect-ratio: 16 / 9;
    min-height: 20rem;
    max-height: calc(100vh - var(--stub-header-height));
  }

  /* The prompt in the player's place starts at the player's 16:9 and grows to fit what it holds where that is too
     short, as on a phone. Not by the ratio itself: a flex item's automatic minimum is then the ratio's height,
     and min-content is too, so it neither grows nor gives the row its height (Chrome 155, 2026-10-26). */
  .no-source {
    aspect-ratio: auto;
    flex-basis: calc(100vw * 9 / 16);
    min-height: auto;
  }

  .fix {
    align-items: center;
    justify-content: center;
    background: #000;

    button {
      padding: 0.8rem 2rem;
      border: none;
      border-radius: 0.6rem;
      background: #fff;
      color: #000;
      font-family: inherit;
      font-size: 1.4rem;
      font-weight: 600;
      cursor: pointer;
    }
  }

  .watch-info {
    padding: 1.6rem 2.4rem;
    width: 100%;
    max-width: 2200px;
    margin: 0 auto;
    box-sizing: border-box;

    &.sources {
      padding-top: 0.8rem;
      padding-bottom: 4rem;
    }

    &.episodes {
      display: flex;
      flex-direction: column;
      gap: 4rem;
      padding-top: 0;
      padding-bottom: 4rem;

      h2 {
        margin: 0 0 1.5rem;
        font-size: 2rem;
      }
    }
  }

  /* Previous at the far left, Next at the far right, the episode between them; below 1100px, where the
     two would squeeze the title and tracking into a narrow column, they sit side by side under it */
  .episode-row {
    display: grid;
    grid-template-areas: 'prev main next';
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: stretch;
    /* Tab in the order drawn: the page lists Previous, the episode and Next as a wide window draws
       them, and the stacked layout, which draws the episode first, needs the grid's rows (Chrome 137) */
    reading-flow: grid-rows;

    @media (max-width: 1100px) {
      grid-template-areas: 'main main' 'prev next';
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 1.2rem 1rem;
    }
  }

  .episode-main {
    grid-area: main;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }

  .episode-info {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.4rem 1rem;

    & > .share {
      grid-area: 1 / 2 / span 2;
    }

    .episode-title {
      font-size: 1.8rem;
      font-weight: 600;
    }

    .episode-title > .pending {
      width: min(24rem, 60vw);
      height: 1.2em;
    }

    .media-title {
      justify-self: start;
      font-size: 1.4rem;
      color: rgba(255, 255, 255, 0.6);

      &:hover {
        color: #fff;
        text-decoration: underline;
      }
    }
  }

  /* the trackers, score, status and episodes run on from the title's left edge, where the row
     elsewhere sits at its right end */
  .tracking .tracking-compact {
    margin-top: 0;

    .row, .platforms {
      justify-content: flex-start;
    }
  }

  .episode-step {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-width: 18rem;
    max-width: 24rem;
    padding: 1.2rem 2rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1rem;
    background: rgb(28, 28, 30);
    color: #fff;
    text-decoration: none;
    transition: background 0.15s ease;

    &:hover {
      background: rgb(34, 34, 37);
    }

    &.previous {
      grid-area: prev;
      margin-right: 2rem;
    }

    &.next {
      grid-area: next;
      justify-content: flex-end;
      margin-left: 2rem;
      text-align: right;
    }

    svg {
      flex-shrink: 0;
      width: 2.8rem;
      height: 2.8rem;
    }

    .step {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 0;
    }

    .step-label {
      font-size: 1.6rem;
      font-weight: 700;
    }

    .step-target {
      overflow: hidden;
      font-size: 1.2rem;
      opacity: 0.6;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 1100px) {
      min-width: 0;
      max-width: none;
      padding: 1rem 1.2rem;

      &.previous,
      &.next {
        margin: 0;
      }
    }
  }
`

type EpisodeLink = { href: string, title?: string }

const EpisodeStep = ({ link, previous = false }: { link: EpisodeLink, previous?: boolean }) => {
  const intl = useIntl()
  return (
    <Link className={`episode-step ${previous ? 'previous' : 'next'}`} href={link.href} title={link.title}>
      {previous ? <ChevronLeft/> : undefined}
      <span className="step">
        <span className="step-label">
          {previous ? intl.formatMessage({ id: 'Previous episode', defaultMessage: 'Previous episode' }) : intl.formatMessage({ id: 'Next episode', defaultMessage: 'Next episode' })}
        </span>
        {link.title ? <span className="step-target">{link.title}</span> : undefined}
      </span>
      {previous ? undefined : <ChevronRight/>}
    </Link>
  )
}

const Watch = () => {
  const intl = useIntl()
  const rawParams = useParams<RouteParams['WATCH']>()
  // wouter hands the segments through undecoded, and an encoded uri is a page that never subscribes
  const params = {
    ...rawParams,
    mediaUri: routeMediaUri(rawParams.mediaUri),
    episodeUri: decodeRouteUri(rawParams.episodeUri),
    sourceUri: decodeRouteUri(rawParams.sourceUri),
  }
  const [, navigate] = useLocation()
  const embedFrame = useRef<HTMLIFrameElement>(null)
  // the player the page can hear and move, from whichever of the two below is up, and the source it plays
  const [playback, setPlayback] = useState<{ link: PlaybackLink, sourceUri?: string }>()
  const [tracksLink, setTracksLink] = useState<TracksLink | undefined>(undefined)

  const [watchMedia] = useSubscription({
    query: GET_WATCH_MEDIA,
    variables: { input: { uri: params.mediaUri } },
    pause: !params.mediaUri
  })

  const media = watchMedia.data?.media
  const episode = useMemo(
    () =>
      media?.episodes?.find(ep =>
        // BOTH SPELLINGS: a one-row episode's uri is `ag:(<row uri>)` now that the singleton path is
        // gone, while a saved or shared `/watch` path still names the row itself
        ep.uri && params.episodeUri
          ? matchAggregatedUris(
            asAggregatedUri(ep.uri) as AggregatedUri,
            asAggregatedUri(params.episodeUri) as AggregatedUri
          )
          : false
      ),
    [media?.episodes, params.episodeUri]
  )

  const selectedSourceUri = params.sourceUri
  // Handed out on its own source only: on the render naming the next one, the last player is still up
  // until its effect closes it, and a link tells each new listener where its player is.
  const playbackLink = playback?.sourceUri === selectedSourceUri ? playback?.link : undefined
  const episodeHandles = useMemo(() => {
    const own = playableHandlesOf(episode?.handles)
    if (!selectedSourceUri || episode?.handles?.some(h => h.node.uri === selectedSourceUri)) return own
    const { origin, id } = fromUri(selectedSourceUri as `${string}:${string}`)
    const url = WATCH_URLS[origin]?.(id)
    return url ? [...own, { uri: selectedSourceUri, origin, url } as typeof own[number]] : own
  }, [episode?.handles, selectedSourceUri])

  const origins = useMemo(
    () =>
      episode?.uri
        ? fromAggregatedUri(episode.uri as AggregatedUri)?.handleUrisValues
        : undefined,
    [episode?.uri]
  )

  // an origin contributing several handles repeats in the aggregated uri, and findOrigins maps ids positionally, so without this the same origin renders once per handle
  const originIds = useMemo(
    () => origins && [...new Set([...origins, ...episodeHandles].map(o => o.origin))],
    [origins, episodeHandles]
  )

  const [{ data: originData }] = useSubscription({
    query: GET_WATCH_ORIGINS,
    variables: { input: { ids: originIds!, filters: [OriginFilter.IsNotApiOnly] } },
    pause: !originIds
  })

  const mediaTitle = media?.titles?.at(0)?.title
  const episodeTitle = episode?.titles?.at(0)?.title
  const episodeNumber = episode?.episodeNumber
  const episodeName = episodeLabel(episodeNumber, episodeTitle)

  const [backend, setBackend] = useState<FknBackend>()
  useEffect(() => {
    let cancelled = false
    void detectBackend().then(detected => { if (!cancelled) setBackend(detected) })
    return () => { cancelled = true }
  }, [])

  // read once per source: a handles update later in the episode would otherwise change the url and reload the player,
  // and so would a language the viewer picks in it
  const triedRelays = useMemo(() => selectedSourceUri ? triedRelaysParams(selectedSourceUri) : {}, [selectedSourceUri])
  const languages = useMemo(() => selectedSourceUri ? trackLanguagesParams() : {}, [selectedSourceUri])

  const embedUrl = useMemo(() => {
    if (!selectedSourceUri) return undefined
    const handle = episodeHandles.find(h => h.uri === selectedSourceUri)
    if (!handle) return undefined
    if (handle.embedUrl) return handle.embedUrl
    const { origin } = fromUri(selectedSourceUri as `${string}:${string}`)
    if (!handle.url || !canPlay(origin, handle.url, backend) || (backend !== 'extension' && EXTENSION_ONLY_ORIGINS.has(origin))) return undefined
    const embedParams = new URLSearchParams({
      mediaUri: params.mediaUri,
      episodeUri: params.episodeUri,
      sourceUri: selectedSourceUri,
      url: handle.url,
      ...triedRelays,
      ...languages,
    })
    // the page sits beside the running build's html, which under fkn.app/app is /build/ and not the origin root
    return `${__STUB_EMBED_PAGE__}?${embedParams}`
  }, [selectedSourceUri, episodeHandles, params.mediaUri, params.episodeUri, triedRelays, languages, backend])

  const plugins = usePluginStatuses()
  const addedSources = plugins.flatMap(plugin => plugin.state === 'connected' ? plugin.sources ?? [] : [])
  const added = addedSources.map(source => source.origin)
  const accessOf = (origin: string) => addedSources.find(source => source.origin === origin)?.access ?? 'none'

  // a plugin source renders its own picker; which added sources do is only known to the worker holding
  // the plugin connection, so it is resolved here and folded into the source list
  const lookupOrigins = added.join(',')
  const [pickers, setPickers] = useState<Record<string, string>>({})
  // and separately, which origins play their own releases: stub mounts the package in the player box
  // and the source renders whatever it wants there. Read together, in one pass over the same origins.
  const [players, setPlayers] = useState<Record<string, string>>()
  const [lookedUp, setLookedUp] = useState<string>()
  useEffect(() => {
    let cancelled = false
    const ids = lookupOrigins ? lookupOrigins.split(',') : []
    const collect = async (lookup: (id: string) => Promise<{ pluginUri: string } | null>) =>
      Object.fromEntries(
        (await Promise.all(ids.map(async id => [id, (await lookup(id))?.pluginUri] as const)))
          .filter((entry): entry is [string, string] => !!entry[1])
      )
    Promise.all([collect(remotePicker), collect(remotePlayer)])
      .then(([picked, played]) => {
        if (cancelled) return
        setPickers(picked)
        setPlayers(played)
        setLookedUp(lookupOrigins)
      })
      .catch(() => { if (!cancelled) setLookedUp(lookupOrigins) })
    return () => { cancelled = true }
  }, [lookupOrigins])

  // an added source that needs an account is asked for the viewer's on every episode, and is neither settled nor
  // free until it answered for this one
  const accountOrigins = added.filter(origin => accessOf(origin) !== 'none').join(',')
  const accountsKey = `${params.episodeUri} ${accountOrigins}`
  const [accountsFor, setAccountsFor] = useState<string>()
  const accountKnown = (origin: string) => accessOf(origin) === 'none' || accountsFor === accountsKey
  useEffect(() => {
    if (!accountOrigins) return
    let cancelled = false
    void Promise.all(accountOrigins.split(',').map(origin => remoteAccount(origin).catch(() => undefined)
      .then(state => { pluginAccounts.record(origin, state) })))
      .then(() => { if (!cancelled) setAccountsFor(accountsKey) })
    return () => { cancelled = true }
  }, [accountsKey])

  // The source's own player wins over stub's built-in ones: it is the source saying how its releases
  // are played, and a release stub cannot open any other way (a magnet) is exactly the case for it.
  const pluginPlayer = useMemo(() => {
    if (!selectedSourceUri) return undefined
    const { origin } = fromUri(selectedSourceUri as `${string}:${string}`)
    const pluginUri = players?.[origin]
    if (!pluginUri) return undefined
    // mounted without its handle, the source is asked to play a release it cannot read and declines it for good
    const handle = episodeHandles.find(h => h.uri === selectedSourceUri)
    if (!handle) return undefined
    return { pluginUri, release: { uri: selectedSourceUri, url: handle.url ?? undefined } }
  }, [selectedSourceUri, players, episodeHandles])

  // a source that declined this release falls back to whatever stub would have done, which is the
  // external link the selector already offers
  const [declined, setDeclined] = useState<string>()
  useEffect(() => { setDeclined(undefined) }, [selectedSourceUri])

  const viaPlugin = Boolean(pluginPlayer && declined !== selectedSourceUri)
  useEffect(() => {
    const iframe = embedFrame.current
    if (viaPlugin || !embedUrl || !iframe) return
    const link = attachPlaybackBridge(iframe)
    const tracks = embedTracks(iframe)
    setPlayback({ link, sourceUri: selectedSourceUri })
    setTracksLink(tracks)
    return () => {
      link.dispose()
      tracks.dispose()
      setPlayback(undefined)
      setTracksLink(undefined)
    }
  }, [viaPlugin, embedUrl])

  useEffect(() => {
    const iframe = embedFrame.current
    if (viaPlugin || !embedUrl || !iframe || !episodeName) return
    return serveEmbedTitle(iframe, episodeName)
  }, [viaPlugin, embedUrl, episodeName])

  useEffect(() => {
    const iframe = embedFrame.current
    if (viaPlugin || !embedUrl || !iframe || !selectedSourceUri) return
    return hearTriedRelays(iframe, selectedSourceUri)
  }, [viaPlugin, embedUrl, selectedSourceUri])

  useEffect(() => {
    const iframe = embedFrame.current
    if (viaPlugin || !embedUrl || !iframe) return
    return hearTrackLanguages(iframe)
  }, [viaPlugin, embedUrl])

  const [unplayable, setUnplayable] = useState<readonly string[]>([])
  useEffect(() => {
    const iframe = embedFrame.current
    if (viaPlugin || !embedUrl || !iframe || !selectedSourceUri) return
    return hearUnplayable(iframe, () => setUnplayable(uris => [...uris, selectedSourceUri]))
  }, [viaPlugin, embedUrl, selectedSourceUri])

  const sources: WatchSource[] = useMemo(
    () =>
      (originData?.originPage?.nodes ?? []).map(origin => {
        const handles = episodeHandles.filter(h => h.origin === origin.id)
        // a source that plays its own releases makes every one of them playable IN stub, so the link
        // goes to the watch route rather than out to whatever the raw url opens (for a torrent index
        // that url is a magnet, which leaves the browser entirely)
        const selfPlaying = Boolean(players?.[origin.id])
        const playableHandle = (handle: typeof handles[number]) =>
          Boolean(handle?.embedUrl || selfPlaying || canPlay(origin.id, handle?.url, backend))
        const pathFor = (sourceUri: string) =>
          getRoutePath(Route.WATCH, { mediaUri: params.mediaUri, episodeUri: params.episodeUri, sourceUri })

        const releases = handles.map(handle => ({
          uri: handle.uri,
          label:
            handle.shortDescriptions?.at(0)?.shortDescription
            ?? handle.titles?.at(0)?.title
            ?? fromUri(handle.uri as `${string}:${string}`).id,
          href: playableHandle(handle) ? pathFor(handle.uri) : (handle.url ?? undefined),
          external: !playableHandle(handle),
          active: selectedSourceUri === handle.uri,
        }))

        const first = handles.at(0)
        // the release playing, else the one the card opens
        const shown = handles.find(handle => handle.uri === selectedSourceUri) ?? first
        return {
          id: origin.id,
          name: origin.name ?? origin.id,
          icon: origin.icon,
          color: origin.color,
          href: first ? (releases.at(0)?.href) : undefined,
          external: first ? !playableHandle(first) : true,
          active: releases.some(release => release.active),
          releases: releases.length > 1 ? releases : undefined,
          picker: pickers[origin.id] ? { pluginUri: pickers[origin.id]! } : undefined,
          thumbnails: [...shown?.thumbnails ?? [], ...episode?.thumbnails ?? []],
          videoQualities: shown?.videoQualities,
          audioQualities: shown?.audioQualities,
          audioLanguages: shown?.audioLanguages,
          subtitleLanguages: shown?.subtitleLanguages,
        }
      }).filter(source => source.href || source.releases),
    [originData, episodeHandles, episode?.thumbnails, params.mediaUri, params.episodeUri, selectedSourceUri, pickers, players, backend]
  )

  // a stream stub plays here only with the extension: Netflix, and Prime Video outside Japan
  const extensionOnly = (handle: { origin: string, url?: string | null, embedUrl?: string | null }) =>
    backend !== 'extension' && !handle.embedUrl && canPlay(handle.origin, handle.url, 'extension')
    && (EXTENSION_ONLY_ORIGINS.has(handle.origin) || !canPlay(handle.origin, handle.url, backend))
  const selected = episodeHandles.find(h => h.uri === selectedSourceUri)
  const skipEvents = useSkipEvents(embedUrl && selected?.origin === 'cr' && selected.url ? crunchyrollEpisodeId(selected.url) : undefined)
  const chapters = useMemo(() => skipEventsToChapters(skipEvents), [skipEvents])
  const needsExtension = backend === 'cloud' && selected && extensionOnly(selected)
    ? builtInSources.find(source => source.origin === selected.origin)?.name
    : undefined

  // a stream that needs the extension, on a browser that cannot add it, cannot play here either
  useEffect(() => {
    if (needsExtension && selectedSourceUri && !canAddExtension()) setUnplayable(uris => [...uris, selectedSourceUri])
  }, [needsExtension, selectedSourceUri])

  // The answer on screen when each added source's package connected. A `settled` on it was reached before
  // the worker asked that source, and the worker answers again only once that source has.
  const connectedOn = useRef(new Map<string, unknown>())
  for (const origin of connectedOn.current.keys()) if (!added.includes(origin)) connectedOn.current.delete(origin)
  for (const origin of added) if (!connectedOn.current.has(origin)) connectedOn.current.set(origin, media)
  const answered = Boolean(media?.settled) && lookedUp === lookupOrigins
  const connecting = plugins.some(plugin => plugin.state === 'connecting')

  const party = useParty()
  const addable = backend === 'extension' || canAddExtension()
  const off = (origin: string) => readDisabledSources().includes(origin)
  const ways: Ways = {
    // on the extension's terms: a stream that needs a sign in or the extension here is still the viewer's to open
    builtIn: (origin, url) => canPlay(origin, url, 'extension'),
    selfPlaying: players && (origin => Boolean(players[origin])),
    off,
    order: playOrder(readPlayOrder(), added),
    possible: origin => !off(origin) && (PLAYABLE_ORIGINS.has(origin)
      ? addable || !EXTENSION_ONLY_ORIGINS.has(origin)
      : connecting || added.includes(origin)),
    settled: origin => answered && (PLAYABLE_ORIGINS.has(origin) || (connectedOn.current.has(origin) && connectedOn.current.get(origin) !== media))
      && accountKnown(origin),
  }
  const guest = party.status === 'joining' || (party.status === 'active' && party.role === 'guest')
  const search = useSearch()

  // a sign in or out, on this page, in its player or in another tab, changes what plays
  const [, setSignIns] = useState(0)
  useEffect(() => {
    const changed = () => setSignIns(count => count + 1)
    const stops = (['crunchyroll', 'prime'] as const).map(site => status.watch(site, changed))
    return () => { for (const stop of stops) stop() }
  }, [])
  // a backend not known yet counts as the cloud, as for canPlay, so Play opens no site still to sign in to before it is known
  const owes = (handle: { origin: string, url?: string | null }) =>
    Boolean(handle.url && canPlay(handle.origin, handle.url, backend) && offersSignIn(handle.origin, backend ?? 'cloud', status))
  // a stream that needs the extension plays nowhere on a browser that cannot add it
  const plays = (handle: { origin: string, url?: string | null, embedUrl?: string | null }) => !owes(handle) && (addable || !extensionOnly(handle))
  // the owner, 2026-10-26: "if we know that the user has previously logged into CR, then we should ask him to
  // re-log into his account, otherwise we wait for the free source"; a stream that needs the extension asks for it
  const neverSignedIn = (handle: { origin: string, url?: string | null, embedUrl?: string | null }) =>
    (neverSignedInTo(handle.origin, status) && !extensionOnly(handle)) || pluginAccounts.neverSignedIn(handle.origin, accessOf(handle.origin))
  // stub's own players are all of paid sites, so one is free only once stub found the viewer signed in there; an
  // added source is free when it needs no account, or said for this episode the viewer is signed in
  const free = (handle: { origin: string, url?: string | null, embedUrl?: string | null }) => PLAYABLE_ORIGINS.has(handle.origin)
    ? foundSignedIn(handle.origin, status) && !extensionOnly(handle)
    : accountKnown(handle.origin) && pluginAccounts.free(handle.origin, accessOf(handle.origin))
  const open = episodeHandles.filter(handle => !unplayable.includes(handle.uri))
  // Play's own pick of a site never signed in to gives way too, once a source plays with nothing to fix
  const cannotPlay = Boolean(selectedSourceUri && (unplayable.includes(selectedSourceUri)
    || (selected && neverSignedIn(selected) && bestSource(open.filter(free), ways))))
  // every source has answered, an added one since its package connected
  const everyAnswered = Boolean(episode && backend) && answered && !connecting
    && ways.order.every(origin => !ways.possible(origin) || ways.settled(origin))
  const pending = connecting || added.some(origin => ways.possible(origin) && !ways.settled(origin))
  // the episode the page last asked the viewer to sign in or add a source for
  const asked = useRef<string | undefined>(undefined)
  const { pick, stuck } = playPick(open, ways, { plays, free, neverSignedIn }, { answered: everyAnswered, asked: asked.current === params.episodeUri, moving: cannotPlay, pending })
  if (stuck) asked.current = params.episodeUri
  // on an episode that lists sources, as one not out yet often lists none
  const noSource = stuck && !guest && !selectedSourceUri && sources.length > 0
  useAutoPick(pick, { ...params, guest, cannotPlay, search }, navigate)
  useResume(playbackLink, selectedSourceUri, episodeHandles.map(handle => handle.uri), guest, startOf(search))

  const episodes = media?.episodes ?? []
  const index = episode ? episodes.indexOf(episode) : -1
  // only a run's first or last episode has a neighbour in another run, so only there is it asked for
  const before = useRun(media && index === 0 ? adjacentRun(media, -1) : undefined)
  const after = useRun(media && index >= 0 && index === episodes.length - 1 ? adjacentRun(media, 1) : undefined)
  const now = useNow()
  // the address's own spelling of this run, so a link inside it keeps the page's subscription
  const { previous, next } = neighbours([before, media ? { ...media, uri: params.mediaUri } : undefined, after], index, new Date(now))
  const playingOrigin = selectedSourceUri ? fromUri(selectedSourceUri as `${string}:${string}`).origin : undefined
  const linkTo = (target: typeof next): EpisodeLink | undefined => target?.episode.uri ? {
    href: getRoutePath(Route.WATCH, {
      mediaUri: target.mediaUri,
      episodeUri: target.episode.uri,
      sourceUri: sourceFor(playableHandlesOf(target.episode.handles), playingOrigin, ways),
    }),
    title: episodeLabel(target.episode.episodeNumber, target.episode.titles?.at(0)?.title),
  } : undefined
  const previousLink = linkTo(previous)
  const nextLink = linkTo(next)
  // a guest follows the host to the next episode, as to any page; one that lists sources but nothing to play asks there
  const upNext = !guest && playableHandlesOf(next?.episode.handles).length ? nextLink : undefined

  // the episode list shows the run playing, or another season of the show the viewer picked while this episode plays
  const [season, setSeason] = useState<{ uri: string, on: string }>()
  const playing = currentMedia(watchMedia, params.mediaUri)
  const playingUris = playing?.handles.map(handle => handle.node.uri) ?? []
  const picked = season?.on === params.episodeUri ? playing?.seasons?.find(each => each.uri === season.uri && !playingUris.includes(each.uri)) : undefined
  const pickedUri = picked && asAggregatedUri(picked.uri)
  const pickedRun = useRun(pickedUri)
  const listed = picked ? pickedRun : playing
  const tracked = useTrackingSummary(listed?.uri)

  return (
    <div css={style}>
      <div className="watch-container">
        {/*
          Keyed, so another source or episode gets a fresh frame: a frame that loads another address in
          place adds a step to the tab's history, and Back then moves the player rather than the page.
        */}
        {noSource
          ? <NoSource signIns={ways.order.filter(origin => open.some(handle => handle.origin === origin && owes(handle)))} accounts={{ backend, crunchyroll, prime, sites, status }}/>
          : (viaPlugin && pluginPlayer) || embedUrl
          ? (
            <div className="player-container">
              {viaPlugin && pluginPlayer
                ? (
                  <PluginPlayer
                    key={pluginPlayer.release.uri}
                    pluginUri={pluginPlayer.pluginUri}
                    release={pluginPlayer.release}
                    onUnplayable={() => setDeclined(selectedSourceUri)}
                    onPlayback={link => setPlayback(link && { link, sourceUri: pluginPlayer.release.uri })}
                  />
                )
                : (
                  <iframe
                    key={embedUrl}
                    ref={embedFrame}
                    src={embedUrl}
                    referrerPolicy="no-referrer"
                    allow="encrypted-media; autoplay; fullscreen;"
                    css={css`
                      width: 100%;
                      border: none;
                      background: #000;
                      flex: 1;
                      min-height: 0;
                    `}
                  />
                )}
              <UpNext link={playbackLink} next={upNext} chapters={chapters}/>
            </div>
          )
          : needsExtension
          ? (
            <div className="player-container fix">
              <button type="button" onClick={() => { void addExtension().then(installed => { if (installed) setBackend('extension') }) }}>
                {intl.formatMessage({ id: 'Install the FKN extension to play {name}', defaultMessage: 'Install the FKN extension to play {name}' }, { name: needsExtension })}
              </button>
            </div>
          )
          : undefined}
        <PartyPlayback link={playbackLink} tracks={tracksLink}/>

        <div className="watch-info">
          <div className="episode-row">
            {previousLink ? <EpisodeStep link={previousLink} previous/> : undefined}
            <div className="episode-main">
              <div className="episode-info">
                <div className="episode-title">{episodeName ?? (episode || media?.settled ? params.episodeUri : <Placeholder className="pending"/>)}</div>
                {mediaTitle ? <Link className="media-title" href={getRoutePath(Route.TITLE, { uri: params.mediaUri })}>{mediaTitle}</Link> : undefined}
                <ShareButton className="share" path={getRoutePath(Route.WATCH, params)} title={mediaTitle}/>
              </div>
              <div className="tracking">
                <MediaTracking
                  work={params.mediaUri}
                  address={params.mediaUri}
                  uri={currentMedia(watchMedia, params.mediaUri)?.uri}
                  title={mediaTitle}
                  cover={media?.covers?.at(0)?.url}
                  episodeCount={media?.episodeCount}
                  movie={media ? isMovieMedia(media) : false}
                  notice={false}
                  link={playbackLink}
                  episode={episodeNumber}
                />
              </div>
            </div>
            {nextLink ? <EpisodeStep link={nextLink}/> : undefined}
          </div>
        </div>
      </div>

      <div className="watch-info sources">
        <SourceSelector
          sources={sources}
          onPickRelease={uri =>
            navigate(getRoutePath(Route.WATCH, {
              mediaUri: params.mediaUri,
              episodeUri: params.episodeUri,
              sourceUri: uri
            }))}
        />
      </div>

      {
        media && !isMovieMedia(media)
          ? (
            <div className="watch-info episodes">
              <MediaSeasons
                seasons={playing?.seasons}
                currentUris={picked ? [picked.uri] : playingUris}
                onPick={uri => setSeason({ uri, on: params.episodeUri })}
              />
              <section data-episodes>
                <h2>{intl.formatMessage({ id: 'Episodes', defaultMessage: 'Episodes' })}</h2>
                {
                  listed
                    ? (
                      <Episodes
                        key={pickedUri ?? params.mediaUri}
                        media={listed}
                        tracked={tracked}
                        current={picked || index < 0 ? undefined : index}
                        mediaUri={pickedUri ?? params.mediaUri}
                        sourceOf={row => row === episode ? selectedSourceUri : sourceFor(playableHandlesOf(row.handles), playingOrigin, ways)}
                      />
                    )
                    : <EpisodesPlaceholder/>
                }
              </section>
            </div>
          )
          : undefined
      }
    </div>
  )
}

export default Watch
