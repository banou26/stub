import type { HTMLAttributes, Ref } from 'react'

import type { Media } from '../generated/schema/types.generated'

import { css } from '@emotion/react'
import { Link } from 'wouter'
import { useCallback, useMemo, useState } from 'preact/hooks'

import { getRoutePath, Route } from '../router/path'
import YoutubeMinimalPlayer from './yt-minimal-player'
import { useCoverUrl } from '../utils/use-cover-url'
import TextEllipsis from '../components/text-ellipsis'

const style = css`
display: grid;
background-color: rgb(35, 35, 35);
border-radius: 1rem;
user-select: none;

width: 70rem;

a {
  color: #fff;
  text-decoration: none;
}

.content {
  padding: 2rem;
  width: 70rem;

  .title {
    margin-bottom: .5rem;
    font-size: 2rem;
    font-weight: 600;
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .description {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 1.25rem;
    font-weight: 500;
    max-height: 5rem;
  }
}

.title-hovercard-player {
  position: relative;
  background-color: #000;
  overflow: hidden;
  border-top-left-radius: 1rem;
  border-top-right-radius: 1rem;
  user-select: none;
  height: 39.25rem;
  width: 70rem;
}

.trailer-fallback-cover {
  position: relative;
  display: grid;
  grid-template: "container";
  background-color: #000;
  overflow: hidden;
  border-top-left-radius: 1rem;
  border-top-right-radius: 1rem;
  user-select: none;
  overflow: hidden;
  height: 39.25rem;
  width: 70rem;
  background-size: cover;
  background-position: center;
}
`

export const MediaPreview = ({ ref, media, ...rest }: HTMLAttributes<HTMLDivElement> & { ref: Ref<HTMLDivElement>, media: Pick<Media, 'uri' | 'titles' | 'shortDescriptions' | 'trailers' | 'covers' | 'episodeCount'> }) => {
  const title = useMemo(() => media?.titles?.at(0)?.title, [media])
  const shortDescription = useMemo(() => media?.shortDescriptions?.at(0)?.shortDescription, [media])
  const cover = useCoverUrl(media?.covers)

  const [bannedTrailerUris, setBannedTrailerUris] = useState<string[]>([])
  const selectedTrailer = useMemo(() => media?.trailers.filter((trailer) => !bannedTrailerUris.includes(trailer.uri)).at(0), [bannedTrailerUris])

  const onTrailerError = useCallback(() => {
    if (!selectedTrailer) return
    setBannedTrailerUris([...bannedTrailerUris, selectedTrailer.uri])
  }, [selectedTrailer, bannedTrailerUris])

  return (
    <div
      ref={ref}
      className="title-hovercard"
      css={style}
      {...rest}
    >
      {
        selectedTrailer?.url
          ? (
            <YoutubeMinimalPlayer
              volume={0}
              url={selectedTrailer?.url}
              onError={onTrailerError}
              redirectTo={getRoutePath(Route.MEDIA, { uri: media.uri })}
              className="title-hovercard-player"
            />
          )
          : (
            cover
              ? (
                <Link
                  className="trailer-fallback-cover"
                  style={{ backgroundImage: `url(${cover})` }}
                  to={getRoutePath(Route.MEDIA, { uri: media.uri })}
                />
              )
              : undefined
          )
      }
      <Link to={getRoutePath(Route.MEDIA, { uri: media.uri })}>
        <div className="content">
          <div className='title'>
            {title}
          </div>
          <div className="top">
            <span className="episodes">
              {media.episodeCount ?? '?'} Episodes
            </span>
          </div>
          <TextEllipsis className="description">
            {shortDescription}
          </TextEllipsis>
        </div>
      </Link>
    </div>
  )
}
