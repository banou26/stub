import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'

const style = css`
  max-width: 72rem;
  margin: 0 auto;
  padding: calc(var(--stub-header-height) + 3rem) 3rem 6rem;
  color: rgba(255, 255, 255, 0.8);

  h1 {
    font-size: 3rem;
    font-weight: 700;
    color: #fff;
    margin-bottom: 0.6rem;
  }

  .updated {
    font-size: 1.3rem;
    color: rgba(255, 255, 255, 0.4);
    margin-bottom: 3rem;
  }

  h2 {
    font-size: 1.9rem;
    font-weight: 600;
    color: #fff;
    margin: 3rem 0 1rem;
  }

  p {
    font-size: 1.5rem;
    line-height: 1.7;
    margin-bottom: 1rem;
  }

  a {
    color: #f47521;

    &:hover {
      color: #ff8a3d;
    }
  }
`

/** The privacy and legal pages, kept in English whatever the page's language until a person reviews a translation. */
export const LegalDoc = ({ children }: { children: ComponentChildren }) => (
  <div css={style} lang="en">{children}</div>
)

export default LegalDoc
