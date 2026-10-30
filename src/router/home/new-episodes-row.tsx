import type { CSSProperties } from 'react'
import type { StoredWork } from './new-episodes'
import type { RowCellProps } from './card-row'

import { css } from '@emotion/react'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'
import { useSubscription } from 'urql'
import { Link } from 'wouter'

import { gql } from '../../generated'
import { getRoutePath, Route } from '../path'
import { VIEWER_LISTS } from '../../components/viewer-lists-query'
import { useNow } from '../../utils/use-now'
import RowTitle from './row-title'
import CardRow from './card-row'
import { MOST, askedOfStore, newEpisodes, releasedOf } from './new-episodes'

/** What stub's merged data says is out of one work: the fields `unreleasedEpisodes` reads. */
const RELEASES = gql(`
  subscription NewEpisodesReleases($input: MediaInput!) {
    media(input: $input) {
      _id
      uri
      status
      settled
      episodeCount
      nextAiringEpisode { episodeNumber airingAt }
      episodes {
        _id
        episodeNumber
        releaseDate
        handles { node { _id origin releaseDate } }
      }
    }
  }
`)

const cardStyle = css`
  position: relative;
  aspect-ratio: 5 / 7;
  border-radius: 1rem;
  overflow: hidden;
  background: #191919;
  color: #fff;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .about {
    position: absolute;
    inset: auto 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 2rem 1.4rem 1.2rem;
    background: linear-gradient(0deg, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.6) 70%, rgba(0, 0, 0, 0) 100%);
    text-shadow: rgb(0 0 0 / 80%) 1px 1px 0;
  }

  .title {
    font-size: 1.8rem;
    font-weight: bold;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .facts {
    display: flex;
    gap: 0.8rem;
    font-size: 1.4rem;
    color: rgba(255, 255, 255, 0.8);
  }

  .new { color: #8fd18f; font-weight: 600; }
`

const rowStyle = css`
  display: flex;
  flex-direction: column;
  --card-gutter: 100px;

  @media (max-width: 768px) {
    --card-gutter: 1.5rem;
  }
`

type Answer = StoredWork & { settled?: boolean | null }

/** Asks stub's merged data what is out of one work, and hands each answer to `onAnswer`. */
const StoreAsk = ({ uri, onAnswer }: { uri: string, onAnswer: (uri: string, media: Answer) => void }) => {
  const [{ data }] = useSubscription({ query: RELEASES, variables: { input: { uri } } })
  const media = data?.media
  useEffect(() => { if (media) onAnswer(uri, media) }, [media])
  return null
}

/**
 * Every new episode of the shows the viewer is watching, newest first (./new-episodes.ts), the asks of stub's merged
 * data that fill them in, to render beside whatever draws them, and whether the viewer's lists or those asks are still
 * being read.
 */
export const useNewEpisodes = () => {
  const now = new Date(useNow())
  const [{ data }] = useSubscription({ query: VIEWER_LISTS })
  const [stored, setStored] = useState<Record<string, Answer>>({})
  const rows = data?.viewerLists?.rows ?? []
  const asked = useMemo(() => askedOfStore(rows, now), [rows])
  // settled once stays settled: a source joining later turns it false again (see useSettledOnce)
  const onAnswer = (uri: string, media: Answer) => setStored(held => ({ ...held, [uri]: { ...media, settled: media.settled || held[uri]?.settled } }))
  return {
    episodes: newEpisodes(rows, row => releasedOf(row, stored[row.uri], now), now),
    asks: asked.map(row => <StoreAsk key={row.uri} uri={row.uri} onAnswer={onAnswer}/>),
    // a first answer can come before the sources that list the episodes, so an asked work is read until it settles
    reading: !data || Boolean(data.viewerLists?.lists.some(list => list.state === 'LOADING')) || asked.some(row => !stored[row.uri]?.settled),
  }
}

type NewEpisode = ReturnType<typeof useNewEpisodes>['episodes'][number]

/** One new episode's card, which opens its work: the cover, the title, the episode to watch next and how many are out. */
export const NewEpisodeCard = ({ episode: { work, next, count }, style }: { episode: NewEpisode, style?: CSSProperties }) => {
  const intl = useIntl()
  return (
    <Link to={getRoutePath(Route.MEDIA, { uri: work.uri })} css={cardStyle} className="card" style={style}>
      {work.summary.cover ? <img src={work.summary.cover} alt="" loading="lazy"/> : undefined}
      <div className="about">
        <span className="title">{work.summary.title ?? work.uri}</span>
        <span className="facts">
          <span>{intl.formatMessage({ id: 'Episode {number}', defaultMessage: 'Episode {number}' }, { number: next })}</span>
          <span className="new">{intl.formatMessage({ id: '{count, plural, one {{count} new} other {{count} new}}#episodes out and not watched', defaultMessage: '{count, plural, one {{count} new} other {{count} new}}', description: 'episodes out and not watched' }, { count })}</span>
        </span>
      </div>
    </Link>
  )
}

const Cell = ({ style, columnIndex, card, episodes }: RowCellProps<{ episodes: NewEpisode[] }>) => {
  const episode = episodes[columnIndex]
  return episode
    ? <NewEpisodeCard episode={episode} style={{ ...style, width: card.width, height: card.height, marginLeft: 'var(--card-gutter, 100px)' }}/>
    : null
}

/** Home's row of the newest MOST, under a heading that opens the page of all of them. Nothing at all while none. */
const NewEpisodes = () => {
  const intl = useIntl()
  const { episodes, asks } = useNewEpisodes()
  return (
    <>
      {asks}
      {
        episodes.length
          ? (
            <section css={rowStyle} className='home-row'>
              <RowTitle title={intl.formatMessage({ id: 'New episodes', defaultMessage: 'New episodes' })} to={getRoutePath(Route.CONTINUE)}/>
              <CardRow count={Math.min(episodes.length, MOST)} cell={Cell} cellProps={{ episodes }}/>
            </section>
          )
          : undefined
      }
    </>
  )
}

export default NewEpisodes
