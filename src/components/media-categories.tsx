import { css } from '@emotion/react'

/**
 * The look of `MediaCategories`, which the page drawing it carries in its own style. A style a component inserts itself
 * lands after the page's first layout effects, where the preview measures the column the pills sit in, so its
 * description drew a frame at the height of unstyled pills.
 */
export const categoriesStyle = css`
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;

  /* a block, not a flex box, whose text would sit in a box of its own that the ellipsis never reaches */
  & > .chip {
    max-width: 100%;
    height: 2.8rem;
    padding: 0 1.1rem;
    line-height: 2.8rem;
    border-radius: 0.6rem;
    font-size: 1.3rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* a source's name keeps its own order inside a right to left page */
    unicode-bidi: plaintext;
  }

  & > .genre { background: rgba(255, 255, 255, 0.12); color: #fff; }
  & > .tag { background: rgba(255, 255, 255, 0.04); color: rgba(255, 255, 255, 0.7); }
`

/** A title's genres, then its tags, as pills, the genres brighter, drawn as `categoriesStyle` says; nothing when it has neither. */
const MediaCategories = ({ genres = [], tags = [] }: { genres?: readonly string[], tags?: readonly string[] }) =>
  genres.length || tags.length
    ? (
      <div className="chips">
        {genres.map(genre => <span key={genre} className="chip genre">{genre}</span>)}
        {tags.map(tag => <span key={tag} className="chip tag">{tag}</span>)}
      </div>
    )
    : null

export default MediaCategories
