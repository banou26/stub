import type { Path } from 'wouter'
import type { ListedMedia } from './listed-media'

import { css } from '@emotion/react'
import { useIntl } from 'react-intl'
import { Link } from 'wouter'

import { airsIn, episodesLabel } from './listed-media'
import { formatLabel, statusLabel } from '../router/search/params'
import { accentVars } from '../utils/color'
import { formatCountdown } from '../utils/countdown'
import { useCoverUrl } from '../utils/use-cover-url'
import { useNow } from '../utils/use-now'
import MediaScore from './media-score'
import { CARD_BOX } from './media-title'

const style = css`
  display: grid;
  grid-template-columns: 5rem minmax(0, 1fr) 11rem 11rem 17rem;
  align-items: center;
  gap: 1.6rem;
  padding: 1rem 1.6rem;
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.85);

  &:hover {
    color: rgba(255, 255, 255, 0.85);
    background: var(--accent-wash);
  }

  &:hover .title { color: #fff; }

  .cover {
    height: 7rem;
    border-radius: 0.4rem;
    background-color: #191919;
    background-size: cover;
    background-position: center;
  }

  .heading { min-width: 0; }

  .title {
    font-size: 1.6rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }

  .chip {
    padding: 0.3rem 0.9rem;
    border-radius: 2rem;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 1.15rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 1.4rem;
  }

  .secondary {
    font-size: 1.3rem;
    color: rgba(255, 255, 255, 0.45);
  }

  /* one place the numbers can differ in width without the column moving under them */
  .column .secondary { font-variant-numeric: tabular-nums; }

  @media (max-width: 900px) {
    grid-template-columns: 5rem minmax(0, 1fr) 11rem;
    .format { display: none; }
  }

  @media (max-width: 640px) {
    grid-template-columns: 5rem minmax(0, 1fr);
    gap: 1.2rem;
    .score { display: none; }
    .chips { display: none; }
  }
`

/**
 * One media as a row, with every column aligned down the page.
 *
 * The densest of the three modes and the only one that shows popularity: a reader comparing twenty
 * results down a column is the reader for whom "82%, 115,797 users" says more than either half does.
 */
const MediaRow = ({ media, to }: { media: ListedMedia, to: Path }) => {
  const intl = useIntl()
  const now = useNow()
  const coverUrl = useCoverUrl(media.covers, media, { box: CARD_BOX })
  const accent = media.covers?.find(cover => cover.color)?.color

  const countdown = formatCountdown(airsIn(media, now) ?? 0, 1)
  const episode = media.nextAiringEpisode?.episodeNumber

  return (
    <Link to={to} css={style} style={accentVars(accent)}>
      <div className="cover" style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}/>
      <div className="heading">
        <div className="title">{media.titles?.at(0)?.title}</div>
        <div className="chips">
          {media.genres?.slice(0, 5).map(genre => <span key={genre} className="chip">{genre.toLowerCase()}</span>)}
        </div>
      </div>
      <div className="column score">
        {media.averageScore != null && <MediaScore percent={media.averageScore} size={17}/>}
        {
          media.popularity != null
            && <span className="secondary">{intl.formatMessage({ id: '{count, plural, one {# user} other {# users}}', defaultMessage: '{count, plural, one {# user} other {# users}}' }, { count: media.popularity })}</span>
        }
      </div>
      <div className="column format">
        <span>{formatLabel(media.type)}</span>
        {media.episodeCount != null && <span className="secondary">{episodesLabel(media.episodeCount)}</span>}
      </div>
      <div className="column">
        <span>{statusLabel(media.status)}</span>
        {
          countdown && episode != null &&
            <span className="secondary airing">{intl.formatMessage({ id: 'Ep {episode} airing in {countdown}', defaultMessage: 'Ep {episode} airing in {countdown}' }, { episode, countdown })}</span>
        }
      </div>
    </Link>
  )
}

export default MediaRow
