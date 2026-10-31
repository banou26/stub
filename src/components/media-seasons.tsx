import { css } from '@emotion/react'
import { useIntl } from 'react-intl'
import { Link, Redirect } from 'wouter'

import { asAggregatedUri } from '../utils/uri'

const style = css`
  & > h2 {
    margin: 0 0 1.2rem;
    font-size: 1.8rem;
  }

  & > nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }

  & > nav > * {
    padding: 0.5rem 1.3rem;
    border-radius: 2rem;
    border: 0.1rem solid rgba(255, 255, 255, 0.15);
    background: none;
    color: rgba(255, 255, 255, 0.7);
    font: inherit;
    font-size: 1.4rem;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }

  & > nav > *:hover { color: #fff; }

  & > nav > [aria-current], & > nav > [aria-pressed='true'] {
    border-color: #fff;
    background: #fff;
    color: #000;
  }
`

type Seasons = readonly { number: number, uri: string }[] | null | undefined

/**
 * The season MediaSeasons sends a show's own page to: its first, when none is on screen. A lone season goes too, as
 * only a season carries a date, and the sources that find a work by its title ask for one (JustWatch, and with it IMDb).
 * A page growing its address holds off while this names one, as the redirect runs first in the same commit and the
 * growth would replace it.
 */
export const firstSeasonRedirect = (seasons: Seasons, currentUris: readonly string[]): string | undefined =>
  seasons?.length && !seasons.some(season => currentUris.includes(season.uri)) ? seasons[0]!.uri : undefined

/**
 * A show's seasons, each linking its own run as a cluster, the one on screen marked. Nothing for one season or none.
 * On the show's own page, where no season is on screen, it replaces the address with the first season. With `onPick`
 * in place of `href`, each season is a button handing `onPick` its uri, and the address never changes.
 */
const MediaSeasons = (props: {
  seasons: Seasons
  /** Every uri the page's media answers to. */
  currentUris: readonly string[]
} & ({ href: (uri: string) => string } | { onPick: (uri: string) => void })) => {
  const { seasons, currentUris } = props
  const intl = useIntl()
  const first = firstSeasonRedirect(seasons, currentUris)
  return first && 'href' in props ? <Redirect to={props.href(asAggregatedUri(first))} replace/>
    : !seasons || seasons.length < 2 ? null
    : (
      <section className="seasons" css={style} data-seasons>
        <h2>{intl.formatMessage({ id: 'Seasons#of a show', defaultMessage: 'Seasons', description: 'of a show' })}</h2>
        <nav>
          {seasons.map(season => {
            const label = intl.formatMessage({ id: 'Season {number}', defaultMessage: 'Season {number}' }, { number: season.number })
            const current = currentUris.includes(season.uri)
            return 'href' in props
              ? <Link key={season.uri} href={props.href(asAggregatedUri(season.uri))} aria-current={current ? 'page' : undefined}>{label}</Link>
              : <button key={season.uri} type="button" aria-pressed={current} onClick={() => props.onPick(season.uri)}>{label}</button>
          })}
        </nav>
      </section>
    )
}

export default MediaSeasons
