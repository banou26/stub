import type { RouteParams } from '../path'

import { css } from '@emotion/react'
import { Check, Clapperboard, LucidePlay, Share2, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useSubscription } from 'urql'
import { Link, useLocation, useParams, useSearch } from 'wouter'

import { MediaDescriptionContentType } from '../../generated/graphql'
import MediaFranchise from '../../components/media-franchise'
import { RelationCard } from '../../components/media-relations'
import MediaScore from '../../components/media-score'
import MediaSeasons from '../../components/media-seasons'
import MediaTracking from '../../components/media-tracking'
import Paged from '../../components/paged'
import Placeholder, { PlaceholderLines } from '../../components/placeholder'
import { carriedSearch } from '../debug/trace'
import { Episodes, EpisodesPlaceholder, GET_MEDIA_DETAILS, playOf, SourceLinks, useTrackingSummary } from '../home/media-details'
import { currentMedia } from '../home/modal-media'
import { isMovieMedia } from '../home/movie'
import { getRoutePath, Route } from '../path'
import { seasonLabel } from '../search/params'
import { sortRelations, watchableRelations } from '../../utils/relation-lanes'
import { AggregatedUri, asAggregatedUri, decodeRouteUri, matchAggregatedUris, shouldGrowAddress } from '../../utils/uri'
import { useCoverUrl } from '../../utils/use-cover-url'
import { castIn, creditLanguages, languageLabel, roleLabel } from './credits'
import { currentEpisode, secondTitle, titleChips, titleFacts } from './facts'

const RELATIONS_ROW = 3
// even, so a full page fills the credits' two columns
const PAGE = 12

const style = css`
  /* the footer under it stays below the fold while the page fills, rather than being pushed off it */
  min-height: 100vh;
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

    /* two lines on a phone, where most titles take two, and one on a wider screen */
    & > h1 > .pending {
      gap: 0.3em;

      @media (min-width: 768px) {
        width: 60%;
        & > * { height: 1.15em; }
        & > :last-child { display: none; }
      }
    }

    & > .season > .pending {
      width: 10rem;
      height: 1.2em;
    }

    & > .chips > .pending {
      width: 24rem;
      height: 3rem;
      border-radius: 1.5rem;
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
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
      color: #000;
      font-size: 1.7rem;
      font-weight: 700;
      text-decoration: none;
    }

    .play:hover { background: rgba(255, 255, 255, 0.85); }

    .play-pending {
      flex: 0 1 22rem;
      height: 4.4rem;
      border-radius: 0.6rem;
    }

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

    /* one line on a phone, the source icons scrolling past the edge, so the row is one height whatever
       has arrived; they fade there so a row cut between two icons still shows there are more */
    @media (max-width: 767px) {
      & > .buttons {
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        mask-image: linear-gradient(to right, #000 calc(100% - 3rem), transparent);
      }
      & > .buttons > *, .origins > * { flex-shrink: 0; }
      .origins { flex-wrap: nowrap; }
    }
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
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 1.2rem;

      @media (min-width: 768px) {
        grid-template-columns: repeat(${RELATIONS_ROW}, minmax(0, 1fr));
      }
    }
  }

  & > .body > .main select {
    height: 3.2rem;
    padding: 0 0.8rem;
    border-radius: 0.6rem;
    border: 0.1rem solid rgba(255, 255, 255, 0.18);
    background: rgb(30, 30, 30);
    color: #fff;
    font: inherit;
    font-size: 1.4rem;
  }

  & > .body > .main .credits {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    margin: 0;
    padding: 0;
    list-style: none;

    @media (min-width: 768px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    & > li {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.8rem;
      border-radius: 0.6rem;
      background: rgba(255, 255, 255, 0.05);

      & > * {
        flex: 1 1 0;
      }
    }

    .person {
      display: flex;
      align-items: center;
      gap: 1rem;
      min-width: 0;
      font-size: 1.4rem;
    }

    .person.actor {
      flex-direction: row-reverse;
      text-align: right;
    }

    .actors {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      min-width: 0;
    }

    .face {
      flex: none;
      width: 4.8rem;
      height: 6.4rem;
      border-radius: 0.4rem;
      object-fit: cover;
      background-color: rgb(45, 45, 45);
    }

    .name {
      overflow-wrap: anywhere;
      color: inherit;
      text-decoration: none;
    }

    a.name:hover { text-decoration: underline; }

    .detail {
      margin-top: 0.2rem;
      color: rgba(255, 255, 255, 0.55);
      font-size: 1.3rem;
      overflow-wrap: anywhere;
    }
  }

  & > .body > .main .themes {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 1.4rem;

    & > li {
      padding: 0.8rem;
      border-radius: 0.6rem;
      background: rgba(255, 255, 255, 0.05);
    }

    .theme {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .toggle {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 3.2rem;
      height: 3.2rem;
      padding: 0;
      border-radius: 50%;
      border: 0;
    }

    button.toggle {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
      cursor: pointer;
    }

    .kind {
      flex: none;
      min-width: 3.6rem;
      color: rgba(255, 255, 255, 0.55);
    }

    .song {
      flex: 1 1 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .artists {
      flex: 1 1 0;
      min-width: 0;
      text-align: right;
      color: rgba(255, 255, 255, 0.55);
      overflow-wrap: anywhere;
    }

    .player {
      max-width: 48rem;
      aspect-ratio: 16 / 9;
      margin-top: 0.8rem;
      border-radius: 0.4rem;
      overflow: hidden;
      background: #000;

      > video {
        display: block;
        width: 100%;
        height: 100%;
      }
    }
  }
`

type Credit = { name: string, image?: string | null, url?: string | null }

/** A face and a name, linking to the source's page for the person when it has one. */
const Person = ({ person, detail, actor }: { person: Credit, detail?: string, actor?: boolean }) => (
  <div className={actor ? 'person actor' : 'person'}>
    {person.image ? <img className="face" src={person.image} alt="" loading="lazy"/> : <div className="face"/>}
    <div>
      {person.url ? <a className="name" href={person.url} target="_blank" rel="noreferrer">{person.name}</a> : <div className="name">{person.name}</div>}
      {detail ? <div className="detail">{detail}</div> : undefined}
    </div>
  </div>
)

type Character = Credit & { role?: string | null, voiceActors: (Credit & { language?: string | null })[] }

const Characters = ({ characters }: { characters: Character[] }) => {
  const languages = creditLanguages(characters)
  const [picked, setPicked] = useState<string>()
  const cast = castIn(characters, picked ?? languages.selected)
  return (
    <section data-characters>
      <h2>
        <span>Characters</span>
        {
          languages.options.length
            ? (
              <select aria-label="Language" value={picked ?? languages.selected} onChange={event => setPicked(event.currentTarget.value)}>
                {languages.options.map(language => <option key={language} value={language}>{languageLabel(language)}</option>)}
              </select>
            )
            : undefined
        }
      </h2>
      <Paged items={cast} size={PAGE} label="Characters">
        {(page, offset) => (
          <ul className="credits">
            {page.map((character, index) => (
              <li key={`${character.name}:${offset + index}`}>
                <Person person={character} detail={roleLabel(character.role)}/>
                {
                  character.actors.length
                    ? <div className="actors">{character.actors.map(actor => <Person key={actor.name} person={actor} actor/>)}</div>
                    : undefined
                }
              </li>
            ))}
          </ul>
        )}
      </Paged>
    </section>
  )
}

const Staff = ({ staff }: { staff: (Credit & { roles?: string[] | null })[] }) => (
  <section data-staff>
    <h2>Staff</h2>
    <Paged items={staff} size={PAGE} label="Staff">
      {(page, offset) => (
        <ul className="credits">
          {page.map((person, index) => (
            <li key={`${person.name}:${offset + index}`}><Person person={person} detail={person.roles?.join(', ')}/></li>
          ))}
        </ul>
      )}
    </Paged>
  </section>
)

type Theme = { kind: string, sequence?: number | null, title?: string | null, artists: string[], video?: string | null }

// the player and videojs behind it load on the first Play, never with the page
const ThemeVideo = ({ url }: { url: string }) => {
  const [ThemePlayer, setThemePlayer] = useState<typeof import('./theme-player').default>()
  useEffect(() => {
    import('./theme-player')
      .then(module => setThemePlayer(() => module.default))
      // a chunk gone since the page loaded, as after a deploy, still plays the theme in the browser's controls
      .catch(() => setThemePlayer(() => ({ url }: { url: string }) => <video src={url} controls autoPlay playsInline/>))
  }, [])
  return <div className="player">{ThemePlayer ? <ThemePlayer url={url}/> : undefined}</div>
}

// one page of songs, keyed by its offset, so paging away stops what was playing on it
const ThemeRows = ({ themes }: { themes: Theme[] }) => {
  const [playing, setPlaying] = useState<number>()
  return (
    <ul className="themes">
      {themes.map((theme, index) => {
        const url = theme.video
        return (
          <li key={index}>
            <div className="theme">
              {
                url
                  ? (
                    <button type="button" className="toggle" aria-label={playing === index ? 'Stop' : 'Play'} onClick={() => setPlaying(playing === index ? undefined : index)}>
                      {playing === index ? <Square size={14} fill="currentColor"/> : <LucidePlay size={14} fill="currentColor"/>}
                    </button>
                  )
                  : <span className="toggle"/>
              }
              <span className="kind">{theme.kind}{theme.sequence ?? ''}</span>
              <span className="song">{theme.title}</span>
              <span className="artists">{theme.artists.join(', ')}</span>
            </div>
            {playing === index && url ? <ThemeVideo url={url}/> : undefined}
          </li>
        )
      })}
    </ul>
  )
}

/** Each opening, ending and insert song, with one of them playing at a time under its row. */
const Themes = ({ themes }: { themes: Theme[] }) => (
  <section data-themes>
    <h2>Themes</h2>
    <Paged items={themes} size={PAGE} label="Themes">
      {(page, offset) => <ThemeRows key={offset} themes={page}/>}
    </Paged>
  </section>
)

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

  const [{ data, operation }] = useSubscription({
    query: GET_MEDIA_DETAILS,
    variables: { input: { uri, details: true }, descriptionInput: { type: MediaDescriptionContentType.Html }, details: true },
    pause: !uri
  })
  const media = data?.media
  const current = currentMedia({ data, operation }, uri)
  const tracked = useTrackingSummary(media?.uri)
  const play = media ? playOf(media, tracked) : undefined

  useEffect(() => {
    if (shouldGrowAddress(media?.uri, routeUri)) {
      navigate(`${getRoutePath(Route.TITLE, { uri: media!.uri })}${location.search}`, { replace: true })
    }
  }, [media?.uri, routeUri])

  const bannerUrl = useCoverUrl(media?.banners, media)
  const coverUrl = useCoverUrl(media?.covers, media)
  const title = media?.titles.at(0)?.title
  const description = media?.descriptions.map(({ description }) => description).sort((a, b) => b.length - a.length).at(0)
  const isMovie = Boolean(media && isMovieMedia(media))
  const relations = sortRelations(watchableRelations(media?.relations ?? []))
  const facts = media ? titleFacts(media) : []
  const chips = media ? titleChips(media) : []
  const season = media ? seasonLabel(media.season, media.seasonYear) : undefined

  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  const descriptionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = descriptionRef.current
    if (element && !open) setClamped(element.scrollHeight > element.clientHeight + 1)
  }, [description, open])

  // a relation opens the next title in this same page, so what was opened on the last one closes again, and the
  // lists, keyed on it, open on their first page; the held uri, which a wider spelling of the same work leaves alone
  useEffect(() => { setOpen(false) }, [uri])
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
          {season ? <div className="season">{season}</div> : current?.settled ? undefined : <div className="season"><Placeholder className="pending"/></div>}
          <h1>{title ?? (current?.settled ? undefined : <PlaceholderLines count={2} className="pending"/>)}</h1>
          {media && secondTitle(media.titles) ? <div className="second">{secondTitle(media.titles)}</div> : undefined}
          {
            chips.length || media?.averageScore != null
              ? (
                <div className="chips">
                  {chips.map(chip => <span className="chip" key={chip}>{chip}</span>)}
                  {media?.averageScore != null ? <span className="chip"><MediaScore percent={media.averageScore} size={16}/></span> : undefined}
                </div>
              )
              : current?.settled ? undefined : <div className="chips"><Placeholder className="pending"/></div>
          }
          {
            description
              ? <div ref={descriptionRef} className={open ? 'description' : 'description clamped'} dangerouslySetInnerHTML={{ __html: description }}/>
              : current?.settled ? undefined : <PlaceholderLines count={5} className="description"/>
          }
          {description && (clamped || open) ? <button type="button" className="expand" onClick={() => setOpen(!open)}>{open ? 'Collapse' : 'Expand'}</button> : undefined}
        </div>
        <div className="actions">
          {
            media
              ? (
                <div className="buttons">
                  {
                    play
                      ? (
                        <Link className="play" href={play.href}>
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
              )
              : <div className="buttons"><Placeholder className="play-pending"/></div>
          }
          <div className="tracking">
            <MediaTracking work={uri} address={routeUri} uri={current?.uri} title={title} cover={coverUrl} episodeCount={current?.episodeCount} movie={isMovie}/>
          </div>
        </div>
        {
          facts.length
            ? (
              <dl className="facts">
                {facts.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            )
            : undefined
        }
        <div key={uri} className="main">
          {
            relations.length
              ? (
                <section className="relations" data-relations>
                  <h2>
                    <span>Relations</span>
                    <MediaFranchise franchise={media?.franchise} currentUris={media?.handles.map(handle => handle.node.uri) ?? []} route={Route.TITLE}/>
                  </h2>
                  <Paged items={relations} size={RELATIONS_ROW} label="Relations">
                    {page => (
                      <div className="grid">
                        {page.map(edge => <RelationCard key={`${edge.relation}:${edge.node.uri}`} edge={edge} search={search} route={Route.TITLE}/>)}
                      </div>
                    )}
                  </Paged>
                </section>
              )
              : undefined
          }
          <MediaSeasons
            seasons={media?.seasons}
            currentUris={media?.handles.map(handle => handle.node.uri) ?? []}
            href={uri => `${getRoutePath(Route.TITLE, { uri })}${search}`}
          />
          {
            media && !isMovie
              ? (
                <section data-episodes>
                  <h2>Episodes</h2>
                  {current ? <Episodes media={current} start={currentEpisode(current.episodes, tracked)}/> : <EpisodesPlaceholder/>}
                </section>
              )
              : undefined
          }
          {media?.characters?.length ? <Characters characters={media.characters}/> : undefined}
          {media?.staff?.length ? <Staff staff={media.staff}/> : undefined}
          {media?.themes?.length ? <Themes themes={media.themes}/> : undefined}
        </div>
      </div>
    </div>
  )
}

export default TitlePage
