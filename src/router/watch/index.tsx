import type { RouteParams } from '../path'
import type { WatchSource } from '../../components/source-selector'

import { css } from '@emotion/react'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useSubscription } from 'urql'
import { useLocation, useParams } from 'wouter'

import { remotePicker, remotePlayer } from '../../worker'

import { OriginFilter } from '../../generated/graphql'
import { gql } from '../../generated'
import { canPlay } from '../../sources/playable'
import SourceSelector from '../../components/source-selector'
import PluginPlayer from '../../components/plugin-player'
import PartyPlayback from '../../components/party-playback'
import { attachPlaybackBridge, type PlaybackLink } from '../../party/bridge'
import { AggregatedUri, asAggregatedUri, fromAggregatedUri, fromUri, matchAggregatedUris, decodeRouteUri } from '../../utils/uri'
import { getRoutePath, Route } from '../path'

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
      episodes {
        ...EpisodeFragment
        episodeNumber
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
    flex: 1;
    min-height: 0;

    .player-loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      font-size: 1.4rem;
      opacity: 0.7;
    }
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

  const origins = useMemo(
    () =>
      episode?.uri
        ? fromAggregatedUri(episode.uri as AggregatedUri)?.handleUrisValues
        : undefined,
    [episode?.uri]
  )

  // an origin contributing several handles repeats in the aggregated uri, and findOrigins maps ids positionally, so without this the same origin renders once per handle
  const originIds = useMemo(
    () => origins && [...new Set(origins.map(o => o.origin))],
    [origins]
  )

  const [{ data: originData }] = useSubscription({
    query: GET_WATCH_ORIGINS,
    variables: { input: { ids: originIds!, filters: [OriginFilter.IsNotApiOnly] } },
    pause: !originIds
  })

  const selectedSourceUri = params.sourceUri
  const mediaTitle = media?.titles?.at(0)?.title
  const episodeTitle = episode?.titles?.at(0)?.title
  const episodeNumber = episode?.episodeNumber

  const embedUrl = useMemo(() => {
    if (!selectedSourceUri) return undefined
    const handle = playableHandlesOf(episode?.handles).find(h => h.uri === selectedSourceUri)
    if (!handle) return undefined
    if (handle.embedUrl) return handle.embedUrl
    const { origin } = fromUri(selectedSourceUri as `${string}:${string}`)
    if (!canPlay(origin) || !handle.url) return undefined
    const embedParams = new URLSearchParams({
      mediaUri: params.mediaUri,
      episodeUri: params.episodeUri,
      sourceUri: selectedSourceUri,
      url: handle.url
    })
    // the page sits beside the running build's html, which under fkn.app/app is /build/ and not the origin root
    return `${__STUB_EMBED_PAGE__}?${embedParams}`
  }, [selectedSourceUri, episode?.handles, params.mediaUri, params.episodeUri])

  // a plugin source renders its own picker; which origins do is only known to the worker holding the
  // plugin connection, so it is resolved here and folded into the source list
  const pickerOrigins = (originData?.originPage?.nodes ?? []).map(origin => origin.id).join(',')
  const [pickers, setPickers] = useState<Record<string, string>>({})
  // and separately, which origins play their own releases: stub mounts the package in the player box
  // and the source renders whatever it wants there. Read together, in one pass over the same origins.
  const [players, setPlayers] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    const ids = pickerOrigins ? pickerOrigins.split(',') : []
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
    const pluginUri = players[origin]
    if (!pluginUri) return undefined
    const handle = playableHandlesOf(episode?.handles).find(h => h.uri === selectedSourceUri)
    return { pluginUri, release: { uri: selectedSourceUri, url: handle?.url ?? undefined } }
  }, [selectedSourceUri, players, episode?.handles])

  // a source that declined this release falls back to whatever stub would have done, which is the
  // external link the selector already offers
  const [declined, setDeclined] = useState<string>()
  useEffect(() => { setDeclined(undefined) }, [selectedSourceUri])

  const viaPlugin = Boolean(pluginPlayer && declined !== selectedSourceUri)
  useEffect(() => {
    const iframe = embedFrame.current
    if (viaPlugin || !embedUrl || !iframe) return
    const link = attachPlaybackBridge(iframe)
    setPlaybackLink(link)
    return () => { link.dispose(); setPlaybackLink(undefined) }
  }, [viaPlugin, embedUrl])

  const sources: WatchSource[] = useMemo(
    () =>
      (originData?.originPage?.nodes ?? []).map(origin => {
        const handles = playableHandlesOf(episode?.handles).filter(h => h.origin === origin.id)
        // a source that plays its own releases makes every one of them playable IN stub, so the link
        // goes to the watch route rather than out to whatever the raw url opens (for a torrent index
        // that url is a magnet, which leaves the browser entirely)
        const selfPlaying = Boolean(players[origin.id])
        const playableHandle = (handle: typeof handles[number]) =>
          Boolean(handle?.embedUrl || selfPlaying || (canPlay(origin.id) && handle?.url))
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
      }),
    [originData, episode?.handles, params.mediaUri, params.episodeUri, selectedSourceUri, pickers, players]
  )

  return (
    <div css={style}>
      <div className="watch-container">
        {viaPlugin && pluginPlayer
          ? (
            <PluginPlayer
              pluginUri={pluginPlayer.pluginUri}
              release={pluginPlayer.release}
              onUnplayable={() => setDeclined(selectedSourceUri)}
              onPlayback={setPlaybackLink}
            />
          )
          : embedUrl
          ? (
            <iframe
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
          )
          : undefined}
        <PartyPlayback link={playbackLink}/>

        <div className="watch-info">
          <div className="episode-info">
            <div className="episode-title">
              {
                episodeTitle
                  ? `${episodeNumber != null ? `E${episodeNumber} - ` : ''}${episodeTitle}`
                  : episodeNumber != null
                    ? `Episode ${episodeNumber}`
                    : params.episodeUri
              }
            </div>
            {mediaTitle ? <div className="media-title">{mediaTitle}</div> : undefined}
          </div>

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
