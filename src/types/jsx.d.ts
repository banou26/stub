import type { JSX as PreactJSX } from 'preact'

// @emotion/react's JSX namespace (our jsxImportSource) reads Preact's two-argument FunctionComponent as
// React 18 and so builds on the GLOBAL `JSX`, which only @types/react 18 declares. Missing, it resolves
// under a @ts-ignore to `any`, and no prop on any element or component is checked.
declare global {
  export import JSX = PreactJSX
}
