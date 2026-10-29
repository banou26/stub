import type { StoredWork } from './new-episodes'

import { css } from '@emotion/react'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'
import { useSubscription } from 'urql'
import { Link } from 'wouter'

import { gql } from '../../generated'
import { getRoutePath, Route } from '../path'
import { VIEWER_LISTS } from '../../components/viewer-lists-query'
import { useNow } from '../../utils/use-now'
import { askedOfStore, newEpisodes, releasedOf } from './new-episodes'

/** What stub's merged data says is out of one work: the fields `unreleasedEpisodes` reads. */
const RELEASES = gql(`
  subscription NewEpisodesReleases($input: MediaInput!) {
    media(input: $input) {
      _id
      uri
      status
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

const style = css`
  display: flex;
  flex-direction: column;
  --card-gutter: 100px;

  /* a column would stretch the link across the page, its hover and focus ring with it */
  & > .heading {
    align-self: flex-start;
    margin-left: 10rem;
    padding-bottom: 0.5rem;
    font-size: 4rem;
    font-weight: bold;
    color: #fff;
    text-shadow: rgba(0, 0, 0, 0.8) -1px -1px 0px, rgba(0, 0, 0, 0.8) -1px 1px 0px, rgba(0, 0, 0, 0.8) 1px -1px 0px, rgba(0, 0, 0, 0.8) 1px 1px 0px;
    user-select: none;
  }

  & > .cards {
    display: flex;
    gap: 1rem;
    padding: 0 var(--card-gutter) 1rem;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: rgb(134, 132, 141) rgb(15, 15, 15);
  }

  .card {
    position: relative;
    flex: 0 0 25rem;
    aspect-ratio: 5 / 7;
    border-radius: 1rem;
    overflow: hidden;
    background: #191919;
    color: #fff;
  }

  .card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .card .about {
    position: absolute;
    inset: auto 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 2rem 1.4rem 1.2rem;
    background: linear-gradient(0deg, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.6) 70%, rgba(0, 0, 0, 0) 100%);
    text-shadow: rgb(0 0 0 / 80%) 1px 1px 0;
  }

  .card .title {
    font-size: 1.8rem;
    font-weight: bold;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .card .facts {
    display: flex;
    gap: 0.8rem;
    font-size: 1.4rem;
    color: rgba(255, 255, 255, 0.8);
  }

  .card .new { color: #8fd18f; font-weight: 600; }

  @media (max-width: 768px) {
    --card-gutter: 1.5rem;

    & > .heading {
      margin-left: 1.5rem;
      font-size: 2.4rem;
    }

    .card { flex-basis: 15rem; }
  }
`

/** Asks stub's merged data what is out of one work, and hands each answer to `onAnswer`. */
const StoreAsk = ({ uri, onAnswer }: { uri: string, onAnswer: (uri: string, media: StoredWork) => void }) => {
  const [{ data }] = useSubscription({ query: RELEASES, variables: { input: { uri } } })
  const media = data?.media
  useEffect(() => { if (media) onAnswer(uri, media) }, [media])
  return null
}

/** Home's row of new episodes of the shows the viewer is watching. Nothing at all while it holds none. */
const NewEpisodes = () => {
  const intl = useIntl()
  const now = new Date(useNow())
  const [{ data }] = useSubscription({ query: VIEWER_LISTS })
  const [stored, setStored] = useState<Record<string, StoredWork>>({})
  const rows = data?.viewerLists?.rows ?? []
  const asked = useMemo(() => askedOfStore(rows, now), [rows])
  const shown = newEpisodes(rows, row => releasedOf(row, stored[row.uri], now), now)
  const onAnswer = (uri: string, media: StoredWork) => setStored(held => ({ ...held, [uri]: media }))

  return (
    <>
      {asked.map(row => <StoreAsk key={row.uri} uri={row.uri} onAnswer={onAnswer}/>)}
      {
        shown.length
          ? (
            <section css={style}>
              <Link to={getRoutePath(Route.LIST)} className="heading">{intl.formatMessage({ id: 'New episodes', defaultMessage: 'New episodes' })}</Link>
              <div className="cards">
                {shown.map(({ work, next, count }) => (
                  <Link key={work._id} to={getRoutePath(Route.MEDIA, { uri: work.uri })} className="card">
                    {work.summary.cover ? <img src={work.summary.cover} alt="" loading="lazy"/> : undefined}
                    <div className="about">
                      <span className="title">{work.summary.title ?? work.uri}</span>
                      <span className="facts">
                        <span>{intl.formatMessage({ id: 'Episode {number}', defaultMessage: 'Episode {number}' }, { number: next })}</span>
                        <span className="new">{intl.formatMessage({ id: '{count, plural, one {{count} new} other {{count} new}}#episodes out and not watched', defaultMessage: '{count, plural, one {{count} new} other {{count} new}}', description: 'episodes out and not watched' }, { count })}</span>
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )
          : undefined
      }
    </>
  )
}

export default NewEpisodes
