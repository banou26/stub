import type { RouteParams } from '../path'
import type { WatchSource } from '../../components/source-selector'

import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useSubscription } from 'urql'
import { Link, useLocation, useParams } from 'wouter'

import { remotePicker, remotePlayer } from '../../worker'

import { OriginFilter } from '../../generated/graphql'
import { gql } from '../../generated'
import { canPlay, EXTENSION_ONLY_ORIGINS } from '../../sources/playable'
import { detectBackend, type FknBackend } from '../../utils/fkn-backend'
import SourceSelector from '../../components/source-selector'
import PluginPlayer from '../../components/plugin-player'
import PartyPlayback from '../../components/party-playback'
import { attachPlaybackBridge, type PlaybackLink } from '../../party/bridge'
import { useParty } from '../../party/use-party'
import { siteStatuses, type StatusSite } from '../../tracking/site-status'
import { hearTriedRelays, triedRelaysParams } from '../../embed-relays'
import { serveEmbedTitle } from '../../embed-title'
import { embedTracks, type TracksLink } from '../../embed-tracks'
import { episodeLabel } from '../../utils/episode-label'
import { AggregatedUri, asAggregatedUri, fromAggregatedUri, fromUri, matchAggregatedUris, decodeRouteUri } from '../../utils/uri'
import { unreleasedEpisodes } from '../home/episodes'
import { isMovieMedia } from '../home/movie'
import { getRoutePath, Route } from '../path'
import { bestSource, useAutoPick, type Ways } from './auto-pick'
import { neighbours, sourceFor } from './neighbours'
import TrackWatched from './track-watched'
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

const STATUS_SITES = new Map<string, StatusSite>([['cr', 'crunchyroll'], ['amazon', 'prime']])

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
      nextAiringEpisode {
        episodeNumber
        airingAt
      }
      episodes {
        ...EpisodeFragment
        episodeNumber
        releaseDate
        titles {
          title
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

const style = css`
  display: flex;
  flex-direction: column;
  height: 100vh;
  /* The bar is fixed, so it takes no room in the flow and every other route pads itself out from
     under it. This one has to as well: without the reservation the header floats over the top strip
     of the player, which is exactly where the source puts its own title and controls. The height is
     the whole viewport minus that strip, which border-box gives us for free. */
  padding-top: var(--stub-header-height);
  overflow: hidden;
  color: rgb(255, 255, 255);

  .watch-container {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .player-container {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .watch-info {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.6rem 2.4rem;
    width: 100%;
    max-width: 2200px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .episode-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.2rem;
  }

  .episode-info {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;

    .episode-title {
      font-size: 1.8rem;
      font-weight: 600;
    }

    .media-title {
      font-size: 1.2rem;
      opacity: 0.6;
    }
  }

  .episode-nav {
    display: flex;
    gap: 0.8rem;

    a {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.8rem 1.2rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 1rem;
      background: rgb(28, 28, 30);
      color: #fff;
      font-size: 1.4rem;
      text-decoration: none;
      transition: background 0.15s ease;

      &:hover {
        background: rgb(34, 34, 37);
      }

      svg {
        width: 1.8rem;
        height: 1.8rem;
      }
    }
  }
`

const Watch = () => {
  const rawParams = useParams<RouteParams['WATCH']>()
  // wouter hands the segments through undecoded, and an encoded uri is a page that never subscribes
  const params = {
    ...rawParams,
    mediaUri: decodeRouteUri(rawParams.mediaUri),
    episodeUri: decodeRouteUri(rawParams.episodeUri),
    sourceUri: decodeRouteUri(rawParams.sourceUri),
  }
  const [, navigate] = useLocation()
  const embedFrame = useRef<HTMLIFrameElement>(null)
  // the player the page can hear and move, from whichever of the two below is up
  const [playbackLink, setPlaybackLink] = useState<PlaybackLink | undefined>(undefined)
  const [tracksLink, setTracksLink] = useState<TracksLink | undefined>(undefined)

  const [{ data }] = useSubscription({
    query: GET_WATCH_MEDIA,
    variables: { input: { uri: params.mediaUri } },
    pause: !params.mediaUri
  })

  const media = data?.media
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

  // read once per source: a handles update later in the episode would otherwise change the url and reload the player
  const triedRelays = useMemo(() => selectedSourceUri ? triedRelaysParams(selectedSourceUri) : {}, [selectedSourceUri])

  const embedUrl = useMemo(() => {
    if (!selectedSourceUri) return undefined
    const handle = episodeHandles.find(h => h.uri === selectedSourceUri)
    if (!handle) return undefined
    if (handle.embedUrl) return handle.embedUrl
    const { origin } = fromUri(selectedSourceUri as `${string}:${string}`)
    if (!handle.url || !canPlay(origin, handle.url)) return undefined
    const embedParams = new URLSearchParams({
      mediaUri: params.mediaUri,
      episodeUri: params.episodeUri,
      sourceUri: selectedSourceUri,
      url: handle.url,
      ...triedRelays,
    })
    // the page sits beside the running build's html, which under fkn.app/app is /build/ and not the origin root
    return `${__STUB_EMBED_PAGE__}?${embedParams}`
  }, [selectedSourceUri, episodeHandles, params.mediaUri, params.episodeUri, triedRelays])

  // a plugin source renders its own picker; which origins do is only known to the worker holding the
  // plugin connection, so it is resolved here and folded into the source list
  const pickerOrigins = (originData?.originPage?.nodes ?? []).map(origin => origin.id).join(',')
  const [pickers, setPickers] = useState<Record<string, string>>({})
  // and separately, which origins play their own releases: stub mounts the package in the player box
  // and the source renders whatever it wants there. Read together, in one pass over the same origins.
  const [players, setPlayers] = useState<Record<string, string>>()
  useEffect(() => {
    if (!pickerOrigins) return
    let cancelled = false
    const ids = pickerOrigins.split(',')
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
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [pickerOrigins])

  // The source's own player wins over stub's built-in ones: it is the source saying how its releases
  // are played, and a release stub cannot open any other way (a magnet) is exactly the case for it.
  const pluginPlayer = useMemo(() => {
    if (!selectedSourceUri) return undefined
    const { origin } = fromUri(selectedSourceUri as `${string}:${string}`)
    const pluginUri = players?.[origin]
    if (!pluginUri) return undefined
    const handle = episodeHandles.find(h => h.uri === selectedSourceUri)
    return { pluginUri, release: { uri: selectedSourceUri, url: handle?.url ?? undefined } }
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
    setPlaybackLink(link)
    setTracksLink(tracks)
    return () => {
      link.dispose()
      tracks.dispose()
      setPlaybackLink(undefined)
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

  const sources: WatchSource[] = useMemo(
    () =>
      (originData?.originPage?.nodes ?? []).map(origin => {
        const handles = episodeHandles.filter(h => h.origin === origin.id)
        // a source that plays its own releases makes every one of them playable IN stub, so the link
        // goes to the watch route rather than out to whatever the raw url opens (for a torrent index
        // that url is a magnet, which leaves the browser entirely)
        const selfPlaying = Boolean(players?.[origin.id])
        const playableHandle = (handle: typeof handles[number]) =>
          Boolean(handle?.embedUrl || selfPlaying || canPlay(origin.id, handle?.url))
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
        }
      }).filter(source => source.href || source.releases),
    [originData, episodeHandles, params.mediaUri, params.episodeUri, selectedSourceUri, pickers, players]
  )

  const [backend, setBackend] = useState<FknBackend>()
  useEffect(() => {
    let cancelled = false
    void detectBackend().then(detected => { if (!cancelled) setBackend(detected) })
    return () => { cancelled = true }
  }, [])

  const party = useParty()
  const ways: Ways = {
    builtIn: (origin, url) => canPlay(origin, url) && (backend === 'extension' || !EXTENSION_ONLY_ORIGINS.has(origin)),
    signedOut: origin => {
      const site = STATUS_SITES.get(origin)
      return site !== undefined && siteStatuses.read(site)?.state === 'signed-out'
    },
    selfPlaying: players && (origin => Boolean(players[origin])),
  }
  const guest = party.status === 'joining' || (party.status === 'active' && party.role === 'guest')
  useAutoPick(bestSource(episodeHandles, ways), { ...params, guest }, navigate)

  const episodes = media?.episodes ?? []
  const { previous, next } = neighbours(episodes, episode ? episodes.indexOf(episode) : -1, media ? unreleasedEpisodes(media) : [])
  const playingOrigin = selectedSourceUri ? fromUri(selectedSourceUri as `${string}:${string}`).origin : undefined
  const linkTo = (target: typeof episode) => target?.uri ? {
    href: getRoutePath(Route.WATCH, {
      mediaUri: params.mediaUri,
      episodeUri: target.uri,
      sourceUri: sourceFor(playableHandlesOf(target.handles), playingOrigin, ways),
    }),
    title: episodeLabel(target.episodeNumber, target.titles?.at(0)?.title),
  } : undefined
  const previousLink = linkTo(previous)
  const nextLink = linkTo(next)
  // a guest follows the host to the next episode, as to any page
  const upNext = !guest && next && bestSource(playableHandlesOf(next.handles), ways) ? nextLink : undefined

  return (
    <div css={style}>
      <div className="watch-container">
        {/*
          Keyed, so another source or episode gets a fresh frame: a frame that loads another address in
          place adds a step to the tab's history, and Back then moves the player rather than the page.
        */}
        {(viaPlugin && pluginPlayer) || embedUrl
          ? (
            <div className="player-container">
              {viaPlugin && pluginPlayer
                ? (
                  <PluginPlayer
                    key={pluginPlayer.release.uri}
                    pluginUri={pluginPlayer.pluginUri}
                    release={pluginPlayer.release}
                    onUnplayable={() => setDeclined(selectedSourceUri)}
                    onPlayback={setPlaybackLink}
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
              <UpNext link={playbackLink} next={upNext}/>
            </div>
          )
          : undefined}
        <PartyPlayback link={playbackLink} tracks={tracksLink}/>

        <div className="watch-info">
          <div className="episode-row">
            <div className="episode-info">
              <div className="episode-title">{episodeName ?? params.episodeUri}</div>
              {mediaTitle ? <div className="media-title">{mediaTitle}</div> : undefined}
            </div>
            {previousLink || nextLink
              ? (
                <nav className="episode-nav">
                  {previousLink ? <Link href={previousLink.href} title={previousLink.title}><ChevronLeft/>Previous episode</Link> : undefined}
                  {nextLink ? <Link href={nextLink.href} title={nextLink.title}>Next episode<ChevronRight/></Link> : undefined}
                </nav>
              )
              : undefined}
          </div>
          {media?.uri
            ? (
              <TrackWatched
                key={params.mediaUri}
                link={playbackLink}
                uri={media.uri}
                episode={episodeNumber}
                movie={isMovieMedia(media)}
                title={mediaTitle}
                cover={media.covers?.at(0)?.url}
                episodeCount={media.episodeCount}
              />
            )
            : undefined}

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
      </div>
    </div>
  )
}

export default Watch
