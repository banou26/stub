import type { RouteParams } from '../path'

import { css } from '@emotion/react'
import { Clapperboard, LucidePlay, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'
import { useSubscription } from 'urql'
import { useLocation, useParams, useSearch } from 'wouter'

import { MediaDescriptionContentType } from '../../generated/graphql'
import MediaFranchise from '../../components/media-franchise'
import MediaRelations, { MediaRecommendations } from '../../components/media-relations'
import MediaScore from '../../components/media-score'
import MediaSeasons, { firstSeasonRedirect } from '../../components/media-seasons'
import MediaTracking from '../../components/media-tracking'
import { NAME_LIST } from '../../i18n'
import Paged from '../../components/paged'
import Placeholder, { PlaceholderLines } from '../../components/placeholder'
import ShareButton from '../../components/share-button'
import SourceSelector from '../../components/source-selector'
import { carriedSearch } from '../debug/trace'
import { Episodes, EpisodesPlaceholder, GET_MEDIA_DETAILS, MediaPlay, SourceLinks, useSettledOnce, useTrackingSummary, useWatchSources, watchOriginIds } from '../home/media-details'
import { currentMedia } from '../home/modal-media'
import { isMovieMedia } from '../home/movie'
import { filmRelease } from '../home/episodes'
import { getRoutePath, Route } from '../path'
import { seasonLabel } from '../search/params'
import { ANIME_CATALOGUES } from '../../site'
import { AggregatedUri, matchAggregatedUris, originsOfUri, routeMediaUri, shouldRewriteAddress } from '../../utils/uri'
import { titleLanguage } from '../../utils/title-language'
import { useCoverUrl } from '../../utils/use-cover-url'
import { castIn, creditLanguages, languageLabel, roleLabel } from './credits'
import { ratingChips, secondTitle, titleChips, titleFacts } from './facts'

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
      /* not normal, which the fallback font of a Japanese title makes 5px taller than a romaji one */
      line-height: 2rem;
      color: rgba(255, 255, 255, 0.6);
      overflow-wrap: anywhere;
    }

    & > .second > .pending {
      width: 20rem;
      height: 2rem;
    }

    /*
     * one line, scrolling past the edge, so the row is one height whatever has arrived, and padded as wide as its
     * fade, so scrolled to its end the last chip shows whole
     */
    & > .chips {
      display: flex;
      gap: 0.8rem;
      margin-top: 0.4rem;
      padding-right: 3rem;
      overflow-x: auto;
      scrollbar-width: none;
      mask-image: linear-gradient(to right, #000 calc(100% - 3rem), transparent);

      & > * { flex-shrink: 0; }
    }

    & > .chips > .chip {
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

    /* as tall as the description drawn: its four lines, then the heading's gap and Expand */
    & > .description[aria-hidden] {
      height: calc(6em + 0.8rem + 1.8rem);
    }

    & > .watch {
      margin-top: 0.4rem;
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
      line-height: 1.8rem;
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

    dd > .pending {
      display: inline-block;
      width: 12rem;
      height: 1em;
      vertical-align: middle;
    }

    /* where the facts sit above the lists, a fact is one line whatever its length or whether it has arrived, so
       they never move the lists: a long value scrolls sideways, fading at the edge */
    @media (max-width: 1023px) {
      gap: 1rem;

      & > div {
        display: flex;
        align-items: center;
        gap: 1.2rem;
        /* not normal, which a Japanese title's fallback font makes 2px taller */
        line-height: 1.8rem;
      }

      dt {
        flex: none;
        width: 11rem;
      }

      dd {
        flex: 1;
        margin: 0;
        min-width: 0;
        white-space: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        mask-image: linear-gradient(to right, #000 calc(100% - 3rem), transparent);
      }
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
  const intl = useIntl()
  const heading = intl.formatMessage({ id: 'Characters', defaultMessage: 'Characters' })
  const languages = creditLanguages(characters)
  const [picked, setPicked] = useState<string>()
  const cast = castIn(characters, picked ?? languages.selected)
  return (
    <section data-characters>
      <h2>
        <span>{heading}</span>
        {
          languages.options.length
            ? (
              <select aria-label={intl.formatMessage({ id: 'Language', defaultMessage: 'Language' })} value={picked ?? languages.selected} onChange={event => setPicked(event.currentTarget.value)}>
                {languages.options.map(language => <option key={language} value={language}>{languageLabel(language)}</option>)}
              </select>
            )
            : undefined
        }
      </h2>
      <Paged items={cast} size={PAGE} label={heading}>
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

const Staff = ({ staff }: { staff: (Credit & { roles?: string[] | null })[] }) => {
  const intl = useIntl()
  const heading = intl.formatMessage({ id: 'Staff', defaultMessage: 'Staff' })
  return (
    <section data-staff>
      <h2>{heading}</h2>
      <Paged items={staff} size={PAGE} label={heading}>
        {(page, offset) => (
          <ul className="credits">
            {page.map((person, index) => (
              <li key={`${person.name}:${offset + index}`}><Person person={person} detail={person.roles ? intl.formatList(person.roles, NAME_LIST) : undefined}/></li>
            ))}
          </ul>
        )}
      </Paged>
    </section>
  )
}

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
  const intl = useIntl()
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
                    <button type="button" className="toggle" aria-label={playing === index ? intl.formatMessage({ id: 'Stop', defaultMessage: 'Stop' }) : intl.formatMessage({ id: 'Play', defaultMessage: 'Play' })} onClick={() => setPlaying(playing === index ? undefined : index)}>
                      {playing === index ? <Square size={14} fill="currentColor"/> : <LucidePlay size={14} fill="currentColor"/>}
                    </button>
                  )
                  : <span className="toggle"/>
              }
              <span className="kind">{theme.kind}{theme.sequence ?? ''}</span>
              <span className="song">{theme.title}</span>
              <span className="artists">{intl.formatList(theme.artists, NAME_LIST)}</span>
            </div>
            {playing === index && url ? <ThemeVideo url={url}/> : undefined}
          </li>
        )
      })}
    </ul>
  )
}

/** Each opening, ending and insert song, with one of them playing at a time under its row. */
const Themes = ({ themes }: { themes: Theme[] }) => {
  const heading = useIntl().formatMessage({ id: 'Themes', defaultMessage: 'Themes' })
  return (
    <section data-themes>
      <h2>{heading}</h2>
      <Paged items={themes} size={PAGE} label={heading}>
        {(page, offset) => <ThemeRows key={offset} themes={page}/>}
      </Paged>
    </section>
  )
}

/** The full page for one title, at `/title/<address>`: what the modal shows, laid out as one long page. */
const TitlePage = () => {
  const intl = useIntl()
  const rawParams = useParams<RouteParams['TITLE']>()
  const routeUri = routeMediaUri(rawParams.uri)
  const [, navigate] = useLocation()
  const search = carriedSearch(useSearch())

  // held across the address growing, as the modal does, so a wider spelling of the same work does
  // not restart the subscription
  const [uri, setUri] = useState(routeUri)
  useEffect(() => {
    setUri(prev =>
      prev && matchAggregatedUris(prev as AggregatedUri, (routeUri ?? '') as AggregatedUri)
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
  const currentUris = media?.handles.map(handle => handle.node.uri) ?? []
  const current = currentMedia({ data, operation }, uri)
  const tracked = useTrackingSummary(media?.uri)

  // a layout effect, run as the answer is drawn: a plain one waits a frame, and a Back taken in that frame renders this
  // page again before the router moves on, which runs the waiting effect first, and it would grow the address over the
  // entry Back landed on
  const written = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (!firstSeasonRedirect(media?.seasons, currentUris) && shouldRewriteAddress(media?.uri, routeUri, written.current)) {
      written.current = media!.uri
      navigate(`${getRoutePath(Route.TITLE, { uri: media!.uri })}${location.search}`, { replace: true })
    }
  }, [media?.uri, routeUri])

  const bannerUrl = useCoverUrl(media?.banners, media)
  const coverUrl = useCoverUrl(media?.covers, media)
  const title = media?.titles.at(0)
  const second = secondTitle(media?.titles)
  // drawn as HTML as it comes: the worker answers the HTML form sanitized (src/worker/resolvers/utils.ts)
  const description = media?.descriptions.map(({ description }) => description).sort((a, b) => b.length - a.length).at(0)
  const isMovie = Boolean(media && isMovieMedia(media))
  const film = isMovie ? media!.episodes.at(0) : undefined
  const { sources, answered } = useWatchSources(film, media?.uri ?? '', media?.handles)
  const settled = useSettledOnce(uri, current?.settled && answered)
  // the anime catalogues name the second title and the facts every anime has, AniList alone names relations, and
  // AniList joins an anime work's sources whichever catalogue the address names
  const anime = originsOfUri(uri ?? '').some(origin => ANIME_CATALOGUES.includes(origin))
  // the clock at draw time: the label only turns at the release, and Play follows the tick
  const upcoming = isMovie && filmRelease({ startDate: media!.startDate, status: media!.status, episode: media!.episodes.at(0) }).upcoming
  const facts = titleFacts(media ?? {}, { locale: intl.locale }, anime && !settled, upcoming)
  const chips = media ? titleChips(media) : []
  const ratings = ratingChips(media ?? {})
  const season = media ? seasonLabel(media.season, media.seasonYear) : undefined

  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  const descriptionRef = useRef<HTMLDivElement>(null)
  // a layout effect, so Expand is drawn in the frame the description is: a plain one waits a frame, drawing the
  // description alone, a line shorter, and everything under it moves up and back
  useLayoutEffect(() => {
    const element = descriptionRef.current
    if (element && !open) setClamped(element.scrollHeight > element.clientHeight + 1)
  }, [description, open])

  // a relation opens the next title in this same page, so what was opened on the last one closes again, and the
  // lists, keyed on it, open on their first page; the held uri, which a wider spelling of the same work leaves alone
  useEffect(() => { setOpen(false) }, [uri])
  const trailer = media?.trailers.at(0)?.url
  const trailerLabel = intl.formatMessage({ id: 'Trailer', defaultMessage: 'Trailer' })

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
          {season ? <div className="season">{season}</div> : settled ? undefined : <div className="season"><Placeholder className="pending"/></div>}
          <h1 lang={title && titleLanguage(title)}>{title?.title ?? (settled ? undefined : <PlaceholderLines count={2} className="pending"/>)}</h1>
          {
            second
              ? <div className="second" lang={titleLanguage(second)}>{second.title}</div>
              : anime && !settled ? <div className="second"><Placeholder className="pending"/></div> : undefined
          }
          {
            chips.length || media?.averageScore != null || ratings.length
              ? (
                <div className="chips">
                  {chips.map(chip => <span className="chip" key={chip}>{chip}</span>)}
                  {media?.averageScore != null ? <span className="chip"><MediaScore percent={media.averageScore} size={16}/></span> : undefined}
                  {ratings.map(rating => <span className="chip" key={rating}>{rating}</span>)}
                </div>
              )
              : settled ? undefined : <div className="chips"><Placeholder className="pending"/></div>
          }
          {
            description
              ? <div ref={descriptionRef} className={open ? 'description' : 'description clamped'} dangerouslySetInnerHTML={{ __html: description }}/>
              : settled ? undefined : <PlaceholderLines count={5} className="description"/>
          }
          {description && (clamped || open) ? <button type="button" className="expand" onClick={() => setOpen(!open)}>{open ? intl.formatMessage({ id: 'Collapse', defaultMessage: 'Collapse' }) : intl.formatMessage({ id: 'Expand', defaultMessage: 'Expand' })}</button> : undefined}
          {isMovie ? <SourceSelector film sources={sources} pending={!settled}/> : undefined}
        </div>
        <div className="actions">
          {
            media
              ? (
                <div className="buttons">
                  <MediaPlay media={media}/>
                  <ShareButton className="icon" path={getRoutePath(Route.TITLE, { uri: media.uri })} title={title?.title}/>
                  {
                    trailer
                      ? <a className="icon" href={trailer} target="_blank" rel="noreferrer" aria-label={trailerLabel} title={trailerLabel}><Clapperboard size={20}/></a>
                      : undefined
                  }
                  <SourceLinks uri={media.uri} handles={media.handles} links={media.streamingLinks} except={watchOriginIds(film, media.handles)}/>
                </div>
              )
              : <div className="buttons"><Placeholder className="play-pending"/></div>
          }
          <div className="tracking">
            <MediaTracking work={uri} address={routeUri} uri={current?.uri} title={title?.title} cover={coverUrl} episodeCount={current?.episodeCount} movie={isMovie}/>
          </div>
        </div>
        {
          facts.length
            ? (
              <dl className="facts">
                {facts.map(({ label, value }) => value
                  ? <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                  : <div key={label} className="fact placeholder" aria-hidden="true"><dt>{label}</dt><dd><Placeholder className="pending"/></dd></div>)}
              </dl>
            )
            : undefined
        }
        <div key={uri} className="main">
          <MediaRelations
            relations={media?.relations ?? []}
            action={<MediaFranchise franchise={media?.franchise} currentUris={currentUris} route={Route.TITLE}/>}
            route={Route.TITLE}
            pending={anime && !settled}
          />
          <MediaSeasons
            seasons={media?.seasons}
            currentUris={currentUris}
            href={uri => `${getRoutePath(Route.TITLE, { uri })}${search}`}
          />
          {
            media && !isMovie
              ? (
                <section data-episodes>
                  <h2>{intl.formatMessage({ id: 'Episodes', defaultMessage: 'Episodes' })}</h2>
                  {current ? <Episodes media={current} tracked={tracked}/> : <EpisodesPlaceholder/>}
                </section>
              )
              : undefined
          }
          <MediaRecommendations recommendations={media?.recommendations ?? []} route={Route.TITLE}/>
          {media?.characters?.length ? <Characters characters={media.characters}/> : undefined}
          {media?.staff?.length ? <Staff staff={media.staff}/> : undefined}
          {media?.themes?.length ? <Themes themes={media.themes}/> : undefined}
        </div>
      </div>
    </div>
  )
}

export default TitlePage
