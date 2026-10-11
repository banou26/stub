import { css } from '@emotion/react'

/** The look of an on and off switch, for an `<input type="checkbox" role="switch">`. */
export const switchStyle = css`
  appearance: none;
  flex: none;
  position: relative;
  width: 3.6rem;
  height: 2rem;
  margin: 0;
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: background 0.15s;

  &::before {
    content: '';
    position: absolute;
    top: 0.2rem;
    left: 0.2rem;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }

  &:checked { background: #4ade80; }
  &:checked::before { transform: translateX(1.6rem); }
  &:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.8); outline-offset: 2px; }

  @media (prefers-reduced-motion: reduce) {
    &, &::before { transition: none; }
  }
`
