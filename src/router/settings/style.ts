import { css } from '@emotion/react'

/** The look every settings section shares: its rows, their buttons and the inline confirmation. */
export const sectionStyle = css`
  scroll-margin-top: calc(var(--stub-header-height) + 2rem);
  padding-bottom: 3.2rem;
  margin-bottom: 3.2rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);

  &:last-of-type {
    border-bottom: none;
    margin-bottom: 0;
  }

  & > h2 {
    font-size: 2.2rem;
    font-weight: 700;
    color: #fff;
    margin-bottom: 0.6rem;
  }

  & > .intro, .intro {
    font-size: 1.5rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.65);
    margin-bottom: 1.6rem;
  }

  h3 {
    font-size: 1.6rem;
    font-weight: 600;
    color: #fff;
  }

  .subheading {
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.45);
    margin: 2.4rem 0 1rem;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1.4rem 1.6rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.02);
    min-width: 0;
  }

  .row .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 1.2rem;
  }

  .row .state {
    font-size: 1.3rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .row .state.on { color: #4ade80; }

  .row p {
    font-size: 1.4rem;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.7);
    overflow-wrap: anywhere;
  }

  .row .note { color: rgba(255, 255, 255, 0.85); }
  .row .note.error { color: #f87171; }

  .facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.3rem 1.2rem;
    font-size: 1.3rem;
    line-height: 1.5;
  }

  .facts dt { color: rgba(255, 255, 255, 0.45); }
  .facts dd { color: rgba(255, 255, 255, 0.75); overflow-wrap: anywhere; }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
  }

  a.link {
    color: #f47521;
    font-size: 1.4rem;
  }

  a.link:hover { color: #ff8a3d; }

  button {
    padding: 0.7rem 1.4rem;
    border-radius: 0.6rem;
    border: none;
    cursor: pointer;
    background: #fff;
    color: #000;
    font-family: inherit;
    font-size: 1.4rem;
    font-weight: 600;
  }

  button.secondary {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: inherit;
    font-weight: 500;
  }

  button.danger {
    background: #f87171;
    color: #000;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .confirm {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1.2rem 1.4rem;
    border-radius: 0.6rem;
    border: 1px solid rgba(248, 113, 113, 0.4);
    background: rgba(248, 113, 113, 0.06);
  }

  .confirm p { color: rgba(255, 255, 255, 0.9); }
`
