import { css } from '@emotion/react'
import { useIntl } from 'react-intl'

import { MediaCategory, MediaType } from '../generated/graphql'

const SERIES_TYPES: readonly (string | null | undefined)[] = [MediaType.Tv, MediaType.TvShort, MediaType.Ona, MediaType.Ova, MediaType.Special]

/** What `kindOf` reads of a media. */
export type Kinded = {
  type?: string | null
  categories?: readonly string[] | null
  handles?: readonly { node: { origin?: string | null } }[] | null
}

/**
 * MOVIE or SERIES as a card tags a media, or nothing when no source names its format.
 *
 * Its format first. Without one, the shelf it is filed under, but not an anime catalogue's: AniList, MyAnimeList, Kitsu
 * and the bundled catalogue file every work they could not type (a music video, an unknown one) as a series, and
 * Crunchyroll every work it lists. JustWatch's shelf stands: it types every film, so what it lists with no type is a
 * show. Read here because a `type` on its shows would reach the merge, whose vetoes leave untyped streaming rows out
 * (src/worker/store/fuzzy-merge.ts).
 */
export const kindOf = ({ type, categories, handles }: Kinded): 'MOVIE' | 'SERIES' | undefined =>
  type === MediaType.Movie ? 'MOVIE'
  : SERIES_TYPES.includes(type) ? 'SERIES'
  : categories?.includes(MediaCategory.Anime) && !handles?.some(({ node }) => node.origin === 'jw') ? undefined
  : categories?.includes(MediaCategory.Movie) ? 'MOVIE'
  : categories?.includes(MediaCategory.Series) ? 'SERIES'
  : undefined

/* over the cover, so a tag a later source names moves nothing, and a click reaches the card's link under it */
const style = css`
  position: absolute;
  top: 0.8rem;
  left: 0.8rem;
  padding: 0.3rem 0.8rem;
  border-radius: 1rem;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 1.2rem;
  font-weight: 600;
  line-height: 1.4rem;
  white-space: nowrap;
  pointer-events: none;
`

/** A small tag reading Movie or Series, or nothing while no source names the media's format (`kindOf`). */
export const KindTag = ({ media }: { media: Kinded }) => {
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
