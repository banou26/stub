// Compiled by `npm run type-check`, never run: each `@ts-expect-error` becomes an error itself once JSX props
// stop being checked, which src/types/jsx.d.ts is for.
import { css } from '@emotion/react'

const Labelled = ({ label }: { label: string }) => <span>{label}</span>
const Styled = ({ className }: { className?: string }) => <span className={className}/>

export const checked = [
  // @ts-expect-error a prop of the wrong type
  <Labelled label={1}/>,
  // @ts-expect-error a required prop left out
  <Labelled/>,
  // @ts-expect-error a prop the component does not take
  <Labelled label="a" nope/>,
  // @ts-expect-error an attribute the element does not take
  <div nope={1}/>,
  // @ts-expect-error `css` is only for a component that takes a className
  <Labelled label="a" css={css`color: red;`}/>,
  // @ts-expect-error `color` takes a string
  <div css={{ color: 1 }}/>,
  <div css={css`color: red;`}/>,
  <Styled css={{ color: 'red' }}/>,
]
