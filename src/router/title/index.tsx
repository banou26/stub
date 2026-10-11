import type { RouteParams } from '../path'

import { css } from '@emotion/react'
import { Check, Clapperboard, LucidePlay, Share2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useSubscription } from 'urql'
import { Link, useLocation, useParams, useSearch } from 'wouter'

import { MediaDescriptionContentType } from '../../generated/graphql'
import MediaFranchise from '../../components/media-franchise'
import { RelationCard } from '../../components/media-relations'
import MediaScore from '../../components/media-score'
import MediaTracking, { MEDIA_TRACKING } from '../../components/media-tracking'
import { carriedSearch } from '../debug/trace'
import { Episodes, GET_MEDIA_DETAILS, SourceLinks, unreleasedEpisodes } from '../home/media-details'
import { isMovieMedia } from '../home/movie'
import { getRoutePath, Route } from '../path'
import { seasonLabel } from '../search/params'
import { sortRelations, watchableRelations } from '../../utils/relation-lanes'
import { AggregatedUri, asAggregatedUri, decodeRouteUri, matchAggregatedUris, shouldGrowAddress } from '../../utils/uri'
import { useCoverUrl } from '../../utils/use-cover-url'
import { playTarget, secondTitle, titleChips, titleFacts } from './facts'

const RELATIONS_ROW = 3

const style = css`
  padding-bottom: 6rem;

  & > .banner {
    position: relative;
    height: min(50vh, 44rem);
    overflow: hidden;

    & > .image {
      position: absolute;
      inset: 0;
      background-size: cover;
      background-position: center 25%;
    }

    /* a portrait cover stretched to a banner: blurred, and pushed past the edges the blur softens */
    & > .image.blurred {
      inset: -4rem;
      filter: blur(2.4rem);
      opacity: 0.6;
    }

    &::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(0deg, #0f0f0f 0%, rgba(15, 15, 15, 0.6) 45%, rgba(15, 15, 15, 0) 100%);
    }
  }

  & > .body {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'cover' 'heading' 'actions' 'facts' 'main';
    gap: 2.4rem;
    max-width: 140rem;
    margin: -12rem auto 0;
    padding: 0 1.6rem;

    @media (min-width: 768px) {
      grid-template-columns: 22rem minmax(0, 1fr);
      grid-template-areas: 'cover heading' 'actions actions' 'facts facts' 'main main';
      gap: 3rem 4rem;
      margin-top: -16rem;
      padding: 0 4rem;
    }

    @media (min-width: 1024px) {
      grid-template-areas: 'cover heading' 'actions actions' 'facts main';
    }
  }

  & > .body > .cover {
    grid-area: cover;
    width: 14rem;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    border-radius: 0.8rem;
    background-color: rgb(35, 35, 35);
    box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.5);

    @media (min-width: 768px) {
      width: 100%;
    }
  }

  & > .body > .heading {
    grid-area: heading;
    align-self: end;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-width: 0;

    & > .season {
      font-size: 1.5rem;
      color: rgba(255, 255, 255, 0.6);
    }

    & > h1 {
      margin: 0;
      font-size: clamp(2.6rem, 4vw, 4.2rem);
      line-height: 1.15;
      overflow-wrap: anywhere;
    }

    & > .second {
      font-size: 1.6rem;
      color: rgba(255, 255, 255, 0.6);
      overflow-wrap: anywhere;
    }

    & > .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.8rem;
      margin-top: 0.4rem;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      height: 3rem;
      padding: 0 1.2rem;
      border-radius: 1.5rem;
      background: rgba(255, 255, 255, 0.1);
      font-size: 1.4rem;
      font-weight: 600;
    }

    & > .description {
      margin-top: 0.8rem;
      font-size: 1.5rem;
      line-height: 1.5;
      color: rgba(255, 255, 255, 0.85);
      overflow-wrap: anywhere;
    }

    & > .description.clamped {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 4;
      overflow: hidden;
    }

    & > .expand {
      align-self: start;
      padding: 0;
      border: none;
      background: none;
      color: rgba(255, 255, 255, 0.7);
      font: inherit;
      font-size: 1.4rem;
      font-weight: 600;
      cursor: pointer;
    }
  }

  & > .body > .actions {
    grid-area: actions;
    min-width: 0;

    & > .buttons {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1rem;
    }

    .play {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.8rem;
      flex: 0 1 22rem;
      height: 4.4rem;
      border-radius: 0.6rem;
      background: #fff;
      color: #000;
      font-size: 1.7rem;
      font-weight: 700;
      text-decoration: none;
    }

    .play:hover { background: rgba(255, 255, 255, 0.85); }

    .icon, .origins > .origin {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 4.4rem;
      height: 4.4rem;
      padding: 0;
      border-radius: 0.6rem;
      border: 0.1rem solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      cursor: pointer;
    }

    .origins {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;

      & > .origin > img { width: 2.6rem; height: 2.6rem; }
      & > .origin > .letter { font-size: 1.6rem; font-weight: 700; }
    }

    /* in place of the top margin the tracking row keeps for the modal */
    & > .tracking > * { margin-top: 1.2rem; }
  }

  & > .body > .facts {
    grid-area: facts;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    margin: 0;
    font-size: 1.4rem;

    dt {
      color: rgba(255, 255, 255, 0.55);
      font-size: 1.3rem;
    }

    dd {
      margin: 0.2rem 0 0;
      overflow-wrap: anywhere;
    }
  }

  & > .body > .main {
    grid-area: main;
    display: flex;
    flex-direction: column;
    gap: 4rem;
    min-width: 0;

    h2 {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      margin: 0 0 1.5rem;
      font-size: 2rem;
    }
  }

  & > .body > .main > .relations {
    & > .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 1.2rem;

      @media (min-width: 768px) {
        grid-template-columns: repeat(${RELATIONS_ROW}, minmax(0, 1fr));
      }
    }

    & > .more {
      margin-top: 1.2rem;
      padding: 0.8rem 1.4rem;
      border-radius: 0.6rem;
      border: 0.1rem solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
      font: inherit;
      font-size: 1.4rem;
      cursor: pointer;
    }
  }
`

/** The full page for one title, at `/title/<address>`: what the modal shows, laid out as one long page. */
const TitlePage = () => {
  const rawParams = useParams<RouteParams['TITLE']>()
  // wouter hands the segment through undecoded, and an encoded uri is a page that never subscribes
  const routeUri = decodeRouteUri(rawParams.uri)
  const [, navigate] = useLocation()
  const search = carriedSearch(useSearch())

  // held across the address growing, as the modal does, so a wider spelling of the same work does
  // not restart the subscription
  const [uri, setUri] = useState(routeUri)
  useEffect(() => {
    setUri(prev =>
      prev && matchAggregatedUris(asAggregatedUri(prev) as AggregatedUri, asAggregatedUri(routeUri ?? '') as AggregatedUri)
        ? prev
        : routeUri
    )
  }, [routeUri])

  const [{ data }] = useSubscription({
    query: GET_MEDIA_DETAILS,
    variables: { input: { uri }, descriptionInput: { type: MediaDescriptionContentType.Html } },
    pause: !uri
  })
  const media = data?.media
  const [{ data: tracking }] = useSubscription({
    query: MEDIA_TRACKING,
    variables: { input: { uri: media?.uri ?? '' } },
    pause: !media?.uri
  })

  useEffect(() => {
    if (shouldGrowAddress(media?.uri, routeUri)) {
      navigate(`${getRoutePath(Route.TITLE, { uri: media!.uri })}${location.search}`, { replace: true })
    }
  }, [media?.uri, routeUri])

  const bannerUrl = useCoverUrl(media?.banners)
  const coverUrl = useCoverUrl(media?.covers)
  const title = media?.titles.at(0)?.title
  const description = media?.descriptions.map(({ description }) => description).sort((a, b) => b.length - a.length).at(0)
  const isMovie = Boolean(media && isMovieMedia(media))
  const unreleased = media ? unreleasedEpisodes(media) : []
  const play = media && playTarget(
    media.episodes.map((episode, index) => ({ ...episode, unreleased: unreleased[index]! })),
    tracking?.tracking?.summary
  )
  const relations = sortRelations(watchableRelations(media?.relations ?? []))
  const facts = media ? titleFacts(media) : []
  const chips = media ? titleChips(media) : []

  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  const descriptionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = descriptionRef.current
    if (element && !open) setClamped(element.scrollHeight > element.clientHeight + 1)
  }, [description, open])

  const [allRelations, setAllRelations] = useState(false)
  const [copied, setCopied] = useState(false)
  const share = async () => {
    if (!media) return
    const url = `${location.origin}${getRoutePath(Route.TITLE, { uri: media.uri })}`
    if (navigator.share) return navigator.share({ title, url }).catch(() => {})
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    } catch {}
  }
  const trailer = media?.trailers.at(0)?.url

  return (
    <div css={style}>
      <div className="banner">
        {
          bannerUrl ?? coverUrl
            ? <div className={bannerUrl ? 'image' : 'image blurred'} style={{ backgroundImage: `url(${bannerUrl ?? coverUrl})` }}/>
            : undefined
        }
      </div>
      <div className="body">
        {coverUrl ? <img className="cover" src={coverUrl} alt=""/> : <div className="cover"/>}
        <div className="heading">
          {media && seasonLabel(media.season, media.seasonYear) ? <div className="season">{seasonLabel(media.season, media.seasonYear)}</div> : undefined}
          <h1>{title}</h1>
          {media && secondTitle(media.titles) ? <div className="second">{secondTitle(media.titles)}</div> : undefined}
          {
            chips.length || media?.averageScore != null
              ? (
                <div className="chips">
                  {chips.map(chip => <span className="chip" key={chip}>{chip}</span>)}
                  {media?.averageScore != null ? <span className="chip"><MediaScore percent={media.averageScore} size={16}/></span> : undefined}
                </div>
              )
              : undefined
          }
          {
            description
              ? <div ref={descriptionRef} className={open ? 'description' : 'description clamped'} dangerouslySetInnerHTML={{ __html: description }}/>
              : undefined
          }
          {description && (clamped || open) ? <button type="button" className="expand" onClick={() => setOpen(!open)}>{open ? 'Collapse' : 'Expand'}</button> : undefined}
        </div>
        {
          media
            ? (
              <div className="actions">
                <div className="buttons">
                  {
                    play
                      ? (
                        <Link className="play" href={getRoutePath(Route.WATCH, { mediaUri: media.uri, episodeUri: play.episodeUri })}>
                          <LucidePlay size={20} fill="currentColor" aria-hidden="true"/>{play.label}
                        </Link>
                      )
                      : undefined
                  }
                  <button type="button" className="icon" onClick={share} aria-label={copied ? 'Copied' : 'Share'} title={copied ? 'Copied' : 'Share'}>
                    {copied ? <Check size={20}/> : <Share2 size={20}/>}
                  </button>
                  {
                    trailer
                      ? <a className="icon" href={trailer} target="_blank" rel="noreferrer" aria-label="Trailer" title="Trailer"><Clapperboard size={20}/></a>
                      : undefined
                  }
                  <SourceLinks uri={media.uri} handles={media.handles}/>
                </div>
                <div className="tracking">
                  <MediaTracking uri={media.uri} title={title} cover={coverUrl} episodeCount={media.episodeCount} movie={isMovie}/>
                </div>
              </div>
            )
            : undefined
        }
        {
          facts.length
            ? (
              <dl className="facts">
                {facts.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            )
            : undefined
        }
        <div className="main">
          {
            relations.length
              ? (
                <section className="relations" data-relations>
                  <h2>
                    <span>Relations</span>
                    <MediaFranchise franchise={media?.franchise} currentUris={media?.handles.map(handle => handle.node.uri) ?? []}/>
                  </h2>
                  <div className="grid">
                    {(allRelations ? relations : relations.slice(0, RELATIONS_ROW)).map(edge =>
                      <RelationCard key={`${edge.relation}:${edge.node.uri}`} edge={edge} search={search}/>
                    )}
                  </div>
                  {
                    relations.length > RELATIONS_ROW && !allRelations
                      ? <button type="button" className="more" onClick={() => setAllRelations(true)}>Show more</button>
                      : undefined
                  }
                </section>
              )
              : undefined
          }
          {
            media && !isMovie && media.episodes.length
              ? (
                <section>
                  <h2>Episodes</h2>
                  <Episodes media={media}/>
                </section>
              )
              : undefined
          }
        </div>
      </div>
    </div>
  )
}

export default TitlePage
