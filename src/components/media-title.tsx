import type { Media } from '../generated/graphql'
import type { CoverOwner } from '../utils/use-cover-url'
import type { Ref } from 'react'
import type { Path } from 'wouter'

import { css } from '@emotion/react'
import { Link } from 'wouter'
import TextEllipsis from './text-ellipsis'
import { useCoverUrl } from '../utils/use-cover-url'

/**
 * The size of the grid's card in CSS px (25rem x 35rem at the 62.5% root font size), the largest image
 * of the listing's three layouts, which every listing card judges a cover's sharpness by.
 */
export const CARD_BOX = { width: 250, height: 350 }

const style = css`
&.card {
  background-color: #191919;
  background-size: cover;
}

&.card, .card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  font-size: 2.5rem;
  overflow: hidden;
  border-radius: 1rem;

  height: 35rem;
  width: 25rem;

  &.link {
    position: absolute;
    inset: 0;
  }

  .information {
    width: 100%;
    text-shadow: rgb(0 0 0 / 80%) 1px 1px 0;
    background:
      linear-gradient(
        0deg,
        rgba(0,0,0,0.5) 0%,
        rgba(0,0,0,0.5) calc(100% - 1rem),
        rgba(0,0,0,0) 100%
      );

    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 1rem 2rem 0rem 2rem;
    color: white;
    font-size: 2.5rem;
    overflow: hidden;
    pointer-events: none;
    max-height: 10rem;

    .title {
      width: 100%;
      max-height: 10rem;

      font-size: 2.2rem;
      font-weight: bold;
      margin: .5rem 0;
    }

    .title-text {
      color: white;
      position: relative;
    }
  }

  &.full-title .information,
  &.full-title .information .title {
    max-height: none;
  }

  /* over the cover, so a tag a later source names moves nothing */
  & > .kind-tag {
    position: absolute;
    top: 0.8rem;
    left: 0.8rem;
    pointer-events: none;
  }
}

/* On mobile the search grid wants fluid cards (it sets no inline size); the home
   carousel pins each cell with an inline width+height from react-window, which wins
   over these, so it's unaffected. */
@media (max-width: 768px) {
  &.card {
    width: 100%;
    height: auto;
    aspect-ratio: 5 / 7;
  }
}
`

const MediaTitle = ({ media, to, ellipsis = true, standIn = false, children, ...rest }: React.ButtonHTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement>, media: Pick<Media, 'titles' | 'covers'> & CoverOwner, to: Path, ellipsis?: boolean, standIn?: boolean }) => {
  const title = media.titles?.at(0)?.title
  const coverUrl = useCoverUrl(media.covers, media, { standIn, box: CARD_BOX })

  return (
    <div
      {...rest}
      css={style}
      className={`card category-item${ellipsis ? '' : ' full-title'}`}
      style={{ ...(typeof rest.style === 'object' ? rest.style : undefined), backgroundImage: coverUrl && `url(${coverUrl})` }}
    >
      <Link
        tabIndex={-1}
        to={to}
        className="card link"
      />
      <div className="information">
          <div className="title">
            <Link to={to} className="title-text">
              {ellipsis ? <TextEllipsis key={title}>{title}</TextEllipsis> : title}
            </Link>
          </div>
      </div>
      {children}
    </div>
  )
}

export default MediaTitle
