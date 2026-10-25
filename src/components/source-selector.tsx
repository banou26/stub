import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { useState } from 'preact/hooks'
import { Link } from 'wouter'

import { useHiddenIcons } from '../sources/hidden-icons'
import { nextThumbnail } from '../utils/thumbnails'
import Placeholder from './placeholder'
import SourcePopup from './source-popup'

/** One concrete pick within an origin, e.g. a single release out of an indexer's several. */
export type SourceRelease = {
  uri: string
  label: string
  href?: string
  external: boolean
  active: boolean
}

export type WatchSource = {
  id: string
  name: string
  icon?: string | null
  color?: string | null
  href?: string
  external: boolean
  active: boolean
  /**
   * Every handle this origin contributed for the episode, when there is more than one.
   *
   * An origin used to resolve to exactly one handle via `handles.find(h => h.origin === id)`, which
   * silently dropped the rest: an indexer contributing five releases for one episode showed a single
   * button pointing at whichever sorted first. When this is set the origin expands into a choice
   * instead, and the compact selector routes to the watch page so the choice has somewhere to happen.
   */
  releases?: SourceRelease[]
  /** set when the source is a plugin that renders its own picker, which replaces the inline list */
  picker?: { pluginUri: string }
  /**
   * What the watch page's card shows, and nothing else does: the pictures to try in order (the
   * source's own, then the episode's), and what the source states about its stream before it plays,
   * as the Episode fields of the same names carry it.
   */
  thumbnails?: readonly { url: string }[]
  videoQualities?: readonly string[] | null
  audioQualities?: readonly string[] | null
  audioLanguages?: readonly string[] | null
  subtitleLanguages?: readonly string[] | null
}

const BRAND_COLORS: Record<string, string> = {
  cr: '#f47521',
  nf: '#e50914',
  jw: '#fcd53f',
  disney: '#0063e5',
  amazon: '#00a8e1',
  appletv: '#e8e8ed',
  hulu: '#1ce783',
  hbo: '#7b5cff',
  peacock: '#069de0',
  paramount: '#0064ff',
  fubo: '#fa4616',
}

const FALLBACK_COLOR = '#9aa0a6'

const brandColor = (source: WatchSource) => source.color || BRAND_COLORS[source.id] || FALLBACK_COLOR

const style = css`
  display: flex;
  flex-direction: column;
  gap: 1.1rem;

  .label {
    font-size: 1.2rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
  }

  .list {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .source {
    --brand: ${FALLBACK_COLOR};
    position: relative;
    display: flex;
    align-items: center;
    gap: 1.1rem;
    min-width: 17rem;
    padding: 0.9rem 1.4rem 0.9rem 1.1rem;
    background: rgb(28, 28, 30);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1rem;
    color: #fff;
    text-decoration: none;
    cursor: pointer;
    overflow: hidden;
    transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--brand);
      opacity: 0.45;
      transition: opacity 0.15s ease, width 0.15s ease;
    }

    &:hover {
      transform: translateY(-2px);
      background: rgb(34, 34, 37);
      border-color: color-mix(in srgb, var(--brand) 55%, transparent);

      &::before {
        opacity: 1;
      }

      .play {
        opacity: 0.9;
      }
    }

    &.active {
      border-color: var(--brand);
      background:
        linear-gradient(
          90deg,
          color-mix(in srgb, var(--brand) 24%, transparent),
          color-mix(in srgb, var(--brand) 7%, transparent)
        );

      &::before {
        width: 4px;
        opacity: 1;
      }
    }

    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 3.2rem;
      height: 3.2rem;
      border-radius: 0.7rem;
      background: color-mix(in srgb, var(--brand) 16%, rgba(255, 255, 255, 0.04));
      color: var(--brand);
      font-size: 1.6rem;
      font-weight: 700;
      text-transform: uppercase;
      overflow: hidden;

      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        padding: 0.45rem;
        box-sizing: border-box;
      }
    }

    .name {
      flex: 1;
      font-size: 1.45rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .play,
    .ext,
    .playing {
      flex-shrink: 0;
    }

    .count {
      flex-shrink: 0;
      padding: 0.1rem 0.6rem;
      border-radius: 1rem;
      background: color-mix(in srgb, var(--brand) 22%, rgba(255, 255, 255, 0.06));
      color: var(--brand);
      font-size: 1.1rem;
      font-weight: 700;
    }

    .play {
      font-size: 1rem;
      color: var(--brand);
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    .ext {
      font-size: 1.4rem;
      color: rgba(255, 255, 255, 0.45);
    }

    .playing {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 1.4rem;

      i {
        width: 3px;
        background: var(--brand);
        border-radius: 1px;
        transform-origin: bottom;
        animation: source-eq 0.9s ease-in-out infinite;
      }

      i:nth-of-type(1) {
        height: 45%;
        animation-delay: 0s;
      }

      i:nth-of-type(2) {
        height: 100%;
        animation-delay: 0.2s;
      }

      i:nth-of-type(3) {
        height: 70%;
        animation-delay: 0.4s;
      }
    }
  }

  &:not(.film) .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(24rem, 1fr));

    @media (max-width: 768px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .source.detailed {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    min-width: 0;
    padding: 0;

    .thumbnail {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      background: rgba(255, 255, 255, 0.04);
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
      min-width: 0;
      padding: 0.9rem 1.4rem 1.1rem 1.1rem;
    }

    .head {
      display: flex;
      align-items: center;
      gap: 1.1rem;
    }

    .name {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .qualities {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .languages {
      display: flex;
      gap: 0.6rem;
      color: rgba(255, 255, 255, 0.75);
      font-size: 1.2rem;
    }

    .languages-label {
      flex-shrink: 0;
      color: rgba(255, 255, 255, 0.45);
      font-weight: 600;
    }

    .names {
      min-width: 0;
    }

    .more {
      display: none;
      flex-shrink: 0;
    }

    /* Where a pointer can hover, the first three names and how many more, the rest in the tooltip and
       still read out; a phone, or a card the keyboard is on, lists them all. The names give way first,
       so how many more there are stays on screen. */
    @media (hover: hover) {
      &:not(:focus-visible) {
        .languages {
          white-space: nowrap;
        }

        .names {
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rest {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
        }

        .more {
          display: block;
        }
      }
    }

    /* the picture beside what it says, so a phone's column of cards stays short */
    @media (max-width: 768px) {
      flex-direction: row;

      .thumbnail {
        flex-shrink: 0;
        align-self: center;
        width: 12rem;
        margin-left: 0.4rem;
        border-radius: 0.6rem;
      }

      .body {
        flex: 1;
      }
    }
  }

  /* a film's are as wide as what they hold, and a name wraps only in one wider than its row */
  &.film .list > .source {
    min-width: 0;

    .name {
      white-space: normal;
    }
  }

  /* one source's box: its icon and padding, and its border */
  .pending {
    min-width: 17rem;
    height: calc(5rem + 2px);
    border-radius: 1rem;
  }

  .source-group {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;

    .source {
      width: 100%;
      font: inherit;
      text-align: left;
    }

    .chevron {
      flex-shrink: 0;
      font-size: 1rem;
      color: rgba(255, 255, 255, 0.45);
    }
  }

  .releases {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding-left: 1.2rem;
    border-left: 1px solid rgba(255, 255, 255, 0.08);

    .release {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      padding: 0.6rem 1rem;
      border-radius: 0.7rem;
      background: rgba(255, 255, 255, 0.03);
      color: rgba(255, 255, 255, 0.75);
      font-size: 1.25rem;
      text-decoration: none;
      transition: background 0.12s ease, color 0.12s ease;

      &:hover {
        background: rgba(255, 255, 255, 0.07);
        color: #fff;

        .play {
          opacity: 0.9;
        }
      }

      &.active {
        background: color-mix(in srgb, var(--brand) 18%, transparent);
        color: #fff;
      }
    }

    .release-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  @keyframes source-eq {
    0%, 100% { transform: scaleY(0.35); }
    50% { transform: scaleY(1); }
  }
`

const compactStyle = css`
  display: flex;
  align-items: center;
  gap: 0.7rem;

  .src {
    --brand: ${FALLBACK_COLOR};
    display: flex;
    text-decoration: none;
    border-radius: 0.6rem;
    transition: transform 0.12s ease;

    &:hover {
      transform: translateY(-2px);
    }

    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2.8rem;
      height: 2.8rem;
      border-radius: 0.6rem;
      border: 1px solid transparent;
      background: color-mix(in srgb, var(--brand) 18%, rgba(255, 255, 255, 0.05));
      color: var(--brand);
      font-size: 1.3rem;
      font-weight: 700;
      text-transform: uppercase;
      overflow: hidden;
      transition: border-color 0.12s ease, background 0.12s ease;

      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        padding: 0.4rem;
        box-sizing: border-box;
      }
    }

    &:hover .icon {
      border-color: var(--brand);
      background: color-mix(in srgb, var(--brand) 30%, rgba(255, 255, 255, 0.05));
    }
  }
`

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' })

// a card names the language, not the region or script it is in: es-419 and es-ES are both Spanish
const languageName = (tag: string) => {
  try {
    return languageNames.of(tag.split('-')[0]!) ?? tag
  } catch {
    return tag
  }
}

const Languages = ({ label, tags }: { label: string, tags?: readonly string[] | null }) => {
  const names = [...new Set((tags ?? []).map(languageName))]
  if (!names.length) return null
  const rest = names.slice(3)
  return (
    <span className="languages" title={`${label}: ${names.join(', ')}`}>
      <span className="languages-label">{label}</span>
      <span className="names">
        {names.slice(0, 3).join(', ')}
        {rest.length ? <span className="rest">, {rest.join(', ')}</span> : undefined}
      </span>
      {rest.length ? <span className="more" aria-hidden="true">+{rest.length}</span> : undefined}
    </span>
  )
}

const detailed = (source: WatchSource) =>
  Boolean(source.thumbnails?.length || source.videoQualities?.length || source.audioQualities?.length || source.audioLanguages?.length || source.subtitleLanguages?.length)

/** The watch page's card: the source's picture over its usual row, then what its stream offers. */
const Details = ({ source, head }: { source: WatchSource, head: ComponentChildren }) => {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const thumbnail = nextThumbnail(source.thumbnails, failed)
  const qualities = [...source.videoQualities ?? [], ...source.audioQualities ?? []]
  return (
    <>
      {thumbnail ? <img className="thumbnail" src={thumbnail} alt="" loading="lazy" onError={() => setFailed(seen => new Set(seen).add(thumbnail))}/> : undefined}
      <span className="body">
        <span className="head">{head}</span>
        {qualities.length ? <span className="qualities">{qualities.map(quality => <span key={quality} className="count">{quality}</span>)}</span> : undefined}
        <Languages label="Audio" tags={source.audioLanguages}/>
        <Languages label="Subtitles" tags={source.subtitleLanguages}/>
      </span>
    </>
  )
}

const SourceIcon = ({ source }: { source: WatchSource }) => {
  const [failed, setFailed] = useState(false)
  return (
    <span className="icon">
      {source.icon && !failed
        ? <img src={source.icon} alt="" onError={() => setFailed(true)} />
        : source.name.charAt(0)}
    </span>
  )
}

// a source played in stub is a client side navigation, which keeps the worker and every match it made this session
const SourceLink = (
  { external, href, ...props }:
  { external: boolean, href?: string, className: string, style?: Record<string, string>, title?: string, children: ComponentChildren }
) =>
  external || !href
    ? <a {...props} href={href} target="_blank" rel="noreferrer"/>
    : <Link {...props} href={href}/>

/**
 * Where an episode plays or can be watched. `compact` draws up to five icons. `film` draws a film's buttons on its own
 * page: no label, every source a link (one with several releases opens the watch page), and a placeholder while
 * `pending`. Both leave out a source whose icon is hidden in Settings.
 */
export const SourceSelector = (
  { sources, compact = false, film = false, pending = false, onPickRelease }:
  { sources: WatchSource[], compact?: boolean, film?: boolean, pending?: boolean, onPickRelease?: (uri: string) => void }
) => {
  const [picking, setPicking] = useState<WatchSource | null>(null)
  const hidden = useHiddenIcons()
  const shown = film ? sources.filter(source => !hidden.has(source.id)) : sources

  if (!shown.length && !(film && pending)) return null

  if (compact) {
    return (
      <div css={compactStyle}>
        {sources.filter(source => !hidden.has(source.id)).slice(0, 5).map(source => (
          <SourceLink
            key={source.id}
            className="src"
            style={{ '--brand': brandColor(source) }}
            href={source.href}
            external={source.external}
            title={`Watch on ${source.name}`}
          >
            <SourceIcon source={source} />
          </SourceLink>
        ))}
      </div>
    )
  }

  return (
    <div css={style} className={film ? 'watch film' : 'watch'}>
      {film ? undefined : <div className="label">Watch on</div>}
      <div className="list">
        {shown.length ? undefined : <Placeholder className="pending"/>}
        {shown.map(source => {
          if (source.releases && source.releases.length > 1 && !film) {
            return <MultiReleaseSource key={source.id} source={source} onOpenPicker={() => setPicking(source)} />
          }
          const head = (
            <>
              <SourceIcon source={source} />
              <span className="name">{source.name}</span>
              {source.releases && source.releases.length > 1 ? <span className="count">{source.releases.length}</span> : undefined}
              {source.active
                ? <span className="playing"><i/><i/><i/></span>
                : source.external
                  ? <span className="ext">↗</span>
                  : <span className="play">▶</span>}
            </>
          )
          const card = !film && detailed(source)
          return (
            <SourceLink
              key={source.id}
              className={`source${card ? ' detailed' : ''}${source.active ? ' active' : ''}`}
              style={{ '--brand': brandColor(source) }}
              href={source.href}
              external={source.external}
              title={source.name}
            >
              {card ? <Details source={source} head={head}/> : head}
            </SourceLink>
          )
        })}
      </div>
      {picking?.picker
        ? (
          <SourcePopup
            pluginUri={picking.picker.pluginUri}
            origin={picking.id}
            name={picking.name}
            uris={(picking.releases ?? []).map(release => release.uri)}
            onPick={uri => { setPicking(null); onPickRelease?.(uri) }}
            onClose={() => setPicking(null)}
          />
        )
        : undefined}
    </div>
  )
}

const MultiReleaseSource = ({ source, onOpenPicker }: { source: WatchSource, onOpenPicker: () => void }) => {
  const releases = source.releases ?? []
  const [open, setOpen] = useState(releases.some(release => release.active))
  // a plugin that renders its own picker replaces the inline list entirely: it knows what its releases
  // are (seeders, size, subtitle tracks) where stub only ever sees a flattened label
  const owned = Boolean(source.picker)
  const head = (
    <>
      <SourceIcon source={source} />
      <span className="name">{source.name}</span>
      <span className="count">{releases.length}</span>
      <span className="chevron">{owned ? '›' : open ? '▾' : '▸'}</span>
    </>
  )
  const card = detailed(source)
  return (
    <div className="source-group" style={{ '--brand': brandColor(source) }}>
      <button
        type="button"
        className={`source${card ? ' detailed' : ''}${source.active ? ' active' : ''}`}
        style={{ '--brand': brandColor(source) }}
        onClick={() => owned ? onOpenPicker() : setOpen(value => !value)}
        title={`${releases.length} releases on ${source.name}`}
        aria-expanded={owned ? undefined : open}
        aria-haspopup={owned ? 'dialog' : undefined}
      >
        {card ? <Details source={source} head={head}/> : head}
      </button>
      {!owned && open
        ? (
          <div className="releases">
            {releases.map(release => (
              <SourceLink
                key={release.uri}
                className={`release${release.active ? ' active' : ''}`}
                href={release.href}
                external={release.external}
                title={release.label}
              >
                <span className="release-label">{release.label}</span>
                {release.active
                  ? <span className="playing"><i/><i/><i/></span>
                  : release.external
                    ? <span className="ext">↗</span>
                    : <span className="play">▶</span>}
              </SourceLink>
            ))}
          </div>
        )
        : undefined}
    </div>
  )
}

export default SourceSelector
