import { css } from '@emotion/react'
import { Link } from 'wouter'

const titleStyle = css`
  /* positioned, so the theater's picture, which hangs below its own box, paints under it rather than over it */
  position: relative;
  /* A row is a flex COLUMN, which blockifies this <a> and stretches it across the viewport, so the heading's box
     (and its hover and focus ring) ran the full width of the screen for a few words of text. Cross-axis start keeps
     the box the size of the words in it. */
  align-self: flex-start;
  margin-left: 10rem;
  font-size: 4rem;
  font-weight: bold;
  color: rgb(255, 255, 255);
  text-shadow: rgba(0, 0, 0, 0.8) -1px -1px 0px, rgba(0, 0, 0, 0.8) -1px 1px 0px, rgba(0, 0, 0, 0.8) 1px -1px 0px, rgba(0, 0, 0, 0.8) 1px 1px 0px;
  padding-bottom: 0.5rem;
  user-select: none;

  @media (max-width: 768px) {
    margin-left: 1.5rem;
    font-size: 2.4rem;
  }
`

/** A home row's heading, first in the row's flex column: a link to the row's own page when it has one. */
const RowTitle = ({ title, to }: { title: string, to?: string }) =>
  to
    ? <Link to={to} css={titleStyle} className='title'>{title}</Link>
    : <span css={titleStyle} className='title'>{title}</span>

export default RowTitle
