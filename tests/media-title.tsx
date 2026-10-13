import { render } from 'preact'

import MediaTitle from '../src/components/media-title'

// The page tests/media-title.spec.ts drives: `window.draw(id, title)` draws a card with that title in
// the box of that id, so a card handed another title can be measured against a fresh one.
const draw = (id: string, title: string) => render(
  <MediaTitle media={{ _id: `cl:${title}`, titles: [{ title }], covers: [] } as never} to="/title"/>,
  document.getElementById(id)!,
)
Object.assign(window, { draw })
