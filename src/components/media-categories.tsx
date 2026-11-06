import { css } from '@emotion/react'
import { Link } from 'wouter'

import { genreLabel, searchPath, siteGenre } from '../router/search/params'

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

  & > a.genre:hover { background: rgba(255, 255, 255, 0.2); }
  /* inside the pill: the title page's row of them scrolls, which clips anything drawn around one */
  & > a.genre:focus-visible { outline: 0.2rem solid rgba(255, 255, 255, 0.8); outline-offset: -0.2rem; }
`

/**
 * A title's genres, then its tags, as pills, the genres brighter and in the page's language, drawn as `categoriesStyle`
 * says; nothing when it has neither. With `linked` each genre the site lists by (`siteGenre`) links to the search for
 * it, so never inside another link, as a card and a row are; any other would open a search no source answers.
 */
const MediaCategories = ({ genres = [], tags = [], linked = false }: { genres?: readonly string[], tags?: readonly string[], linked?: boolean }) =>
  genres.length || tags.length
    ? (
      <div className="chips">
        {genres.map(genre => {
          const listed = linked && siteGenre(genre)
          return listed
            ? <Link key={genre} className="chip genre" href={searchPath({ genres: [listed] })}>{genreLabel(genre)}</Link>
            : <span key={genre} className="chip genre">{genreLabel(genre)}</span>
        })}
        {tags.map(tag => <span key={tag} className="chip tag">{tag}</span>)}
      </div>
    )
    : null

export default MediaCategories
