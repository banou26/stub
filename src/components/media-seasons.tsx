import { css } from '@emotion/react'
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

  & > nav > a {
    padding: 0.5rem 1.3rem;
    border-radius: 2rem;
    border: 0.1rem solid rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.7);
    font-size: 1.4rem;
    text-decoration: none;
    white-space: nowrap;
  }

  & > nav > a:hover { color: #fff; }

  & > nav > a[aria-current] {
    border-color: #fff;
    background: #fff;
    color: #000;
  }
`

/**
 * A show's seasons, each linking its own run as a cluster, the one on screen marked. Nothing for one season or none.
 * On the show's own page, where no season is on screen, it replaces the address with the first season.
 */
const MediaSeasons = ({ seasons, currentUris, href }: {
  seasons: readonly { number: number, uri: string }[] | null | undefined
  /** Every uri the page's media answers to. */
  currentUris: readonly string[]
  href: (uri: string) => string
}) =>
  !seasons || seasons.length < 2 ? null
  : !seasons.some(season => currentUris.includes(season.uri)) ? <Redirect to={href(asAggregatedUri(seasons[0]!.uri))} replace/>
  : (
    <section className="seasons" css={style} data-seasons>
      <h2>Seasons</h2>
      <nav>
        {seasons.map(season => (
          <Link key={season.uri} href={href(asAggregatedUri(season.uri))} aria-current={currentUris.includes(season.uri) ? 'page' : undefined}>
            Season {season.number}
          </Link>
        ))}
      </nav>
    </section>
  )

export default MediaSeasons
