import { css } from '@emotion/react'
import { useIntl } from 'react-intl'

import { MediaCategory, MediaType } from '../generated/graphql'

const SERIES_TYPES: readonly (string | null | undefined)[] = [MediaType.Tv, MediaType.TvShort, MediaType.Ona, MediaType.Ova, MediaType.Special]

/**
 * MOVIE or SERIES as a card tags a media, or nothing when no source names its format.
 *
 * Its format first. Without one, the shelf a live-action catalogue files it under, but never an anime one's: AniList,
 * MyAnimeList, Kitsu and the bundled catalogue file every work they could not type (a music video, an unknown one) as
 * a series, and Crunchyroll every work it lists.
 */
export const kindOf = (
  { type, categories }: { type?: string | null, categories?: readonly string[] | null }
): 'MOVIE' | 'SERIES' | undefined =>
  type === MediaType.Movie ? 'MOVIE'
  : SERIES_TYPES.includes(type) ? 'SERIES'
  : categories?.includes(MediaCategory.Anime) ? undefined
  : categories?.includes(MediaCategory.Movie) ? 'MOVIE'
  : categories?.includes(MediaCategory.Series) ? 'SERIES'
  : undefined

const style = css`
  display: inline-block;
  padding: 0.3rem 0.8rem;
  border-radius: 1rem;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 1.2rem;
  font-weight: 600;
  line-height: 1.4rem;
  white-space: nowrap;
`

/** A small tag reading Movie or Series, or nothing while no source names the media's format (`kindOf`). */
export const KindTag = ({ media }: { media: { type?: string | null, categories: readonly string[] } }) => {
  const intl = useIntl()
  const kind = kindOf(media)
  if (!kind) return null
  return (
    <span css={style} className="kind-tag">
      {
        kind === 'MOVIE'
          ? intl.formatMessage({ id: 'Movie', defaultMessage: 'Movie' })
          : intl.formatMessage({ id: 'Series#a title that is not a movie', defaultMessage: 'Series', description: 'a title that is not a movie' })
      }
    </span>
  )
}

export default KindTag
