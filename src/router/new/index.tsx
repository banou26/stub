import { css } from '@emotion/react'
import { useIntl } from 'react-intl'

import { NewEpisodeCard, useNewEpisodes } from '../home/new-episodes-row'

// the season's search page's header and grid (../search), holding home's new episode cards
const style = css`
  padding: calc(var(--stub-header-height) + 3rem) 3rem 4rem;
  min-height: 100vh;

  .heading {
    margin-bottom: 2rem;
    font-size: 2.4rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(25rem, 1fr));
    gap: 2rem;
    justify-items: center;
  }

  .grid > * { width: 25rem; }

  .status {
    font-size: 1.8rem;
    color: rgba(255, 255, 255, 0.5);
  }

  @media (max-width: 768px) {
    padding: calc(var(--stub-header-height) + 1rem) 1.5rem 3rem;

    .heading { font-size: 2rem; }

    .grid {
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      gap: 1.2rem;
    }

    .grid > * { width: 100%; }
  }
`

/** Every new episode of the shows the viewer is watching: the page home's New episodes heading opens. */
const New = () => {
  const intl = useIntl()
  const { episodes, asks, reading } = useNewEpisodes()
  return (
    <div css={style}>
      {asks}
      <div className="heading">{intl.formatMessage({ id: 'New episodes', defaultMessage: 'New episodes' })}</div>
      {
        episodes.length
          ? <div className="grid">{episodes.map(episode => <NewEpisodeCard key={episode.work._id} episode={episode}/>)}</div>
          : reading
            ? undefined
            : <div className="status">{intl.formatMessage({ id: 'No new episodes', defaultMessage: 'No new episodes' })}</div>
      }
    </div>
  )
}

export default New
