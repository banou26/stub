import type { Path } from 'wouter'
import type { ListedMedia } from './listed-media'

import { css } from '@emotion/react'
import { Link } from 'wouter'

import { airsIn, episodesLabel } from './listed-media'
import { formatLabel, seasonLabel, statusLabel } from '../router/search/params'
import { accentVars } from '../utils/color'
import { formatCountdown } from '../utils/countdown'
import { useCoverUrl } from '../utils/use-cover-url'
import { useNow } from '../utils/use-now'
import MediaScore from './media-score'

const style = css`
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr);
  height: 23rem;
  border-radius: 0.8rem;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.85);

  &:hover { color: rgba(255, 255, 255, 0.85); }
  &:hover .title { color: #fff; }

  .cover {
    position: relative;
    background-color: #191919;
    background-size: cover;
    background-position: center;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  .cover-text {
    padding: 1rem;
    background: linear-gradient(0deg, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.75) 60%, rgba(0, 0, 0, 0) 100%);
    text-shadow: rgb(0 0 0 / 80%) 1px 1px 0;
  }

  .title {
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.3;
    color: #fff;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .season {
    margin-top: 0.4rem;
    font-size: 1.3rem;
    font-weight: 600;
    color: var(--accent);
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1.4rem 1.6rem;
    background: var(--accent-wash);
    min-width: 0;
  }

  .detail-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    font-size: 1.4rem;
  }

  .airing-label {
    color: rgba(255, 255, 255, 0.5);
    font-size: 1.3rem;
  }

  .airing-value {
    font-size: 1.8rem;
    font-weight: 500;
    color: #fff;
  }

  .meta {
    font-size: 1.3rem;
    color: rgba(255, 255, 255, 0.5);
  }

  /* NOT flex: 1. A line clamp puts the ellipsis on the clamp line but leaves the lines after it in
     the box, and only a hidden overflow over a box the clamped text exactly fills keeps them out of
     sight. Stretched to fill the column, the card showed three clamped lines and then two more below
     the ellipsis. The chips carry the spare space instead. */
  .description {
    font-size: 1.3rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.6);
    display: -webkit-box;
    -webkit-line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: auto;
  }

  .chip {
    padding: 0.4rem 1rem;
    border-radius: 2rem;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 1.2rem;
    font-weight: 600;
    white-space: nowrap;
  }

  @media (max-width: 768px) {
    grid-template-columns: 11rem minmax(0, 1fr);
    height: 17rem;

    .detail { padding: 1rem; gap: 0.5rem; }
    .airing-value { font-size: 1.5rem; }
    .description { -webkit-line-clamp: 3; }
    .chips { display: none; }
  }
`

/**
 * One media as a cover beside the facts that fit in a paragraph.
 *
 * The top line is the run's next airing when a source has one scheduled, and its status otherwise, so
 * the same slot always answers "where is this up to" rather than going blank on a finished show.
 */
const MediaCard = ({ media, to }: { media: ListedMedia, to: Path }) => {
  const now = useNow()
  const coverUrl = useCoverUrl(media.covers, media)
  const accent = media.covers?.find(cover => cover.color)?.color

  const countdown = formatCountdown(airsIn(media, now) ?? 0)
  const episode = media.nextAiringEpisode?.episodeNumber
  const format = formatLabel(media.type)
  const season = seasonLabel(media.season, media.seasonYear)
  const meta = [format, episodesLabel(media.episodeCount)].filter(Boolean).join(' • ')

  return (
    <Link to={to} css={style} style={accentVars(accent)}>
      <div className="cover" style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}>
        <div className="cover-text">
          <div className="title">{media.titles?.at(0)?.title}</div>
          {season && <div className="season">{season}</div>}
        </div>
      </div>
      <div className="detail">
        <div className="detail-top">
          <div>
            {
              countdown && episode != null
                ? (
                  <>
                    <div className="airing-label">Ep {episode} airing in</div>
                    <div className="airing-value airing">{countdown}</div>
                  </>
                )
                : <div className="airing-value">{statusLabel(media.status) ?? 'Unknown status'}</div>
            }
          </div>
          {media.averageScore != null && <MediaScore percent={media.averageScore}/>}
        </div>
        {meta && <div className="meta">{meta}</div>}
        <div className="description">{media.shortDescriptions?.at(0)?.shortDescription}</div>
        <div className="chips">
          {media.genres?.slice(0, 2).map(genre => <span key={genre} className="chip">{genre.toLowerCase()}</span>)}
        </div>
      </div>
    </Link>
  )
}

export default MediaCard
