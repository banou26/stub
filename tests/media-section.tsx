import { render } from 'preact'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { MediaSection } from '../src/router/home/media-section'

// The page tests/media-section.spec.ts drives: `window.draw(count)` draws a home row of that many cards,
// none being the row before the worker has answered.
const { hook } = memoryLocation({ path: '/' })
const show = (index: number) => ({ _id: `cl:${index}`, uri: `ag:(anilist:${index})`, titles: [{ title: `Show ${index}` }], covers: [], handles: [] })
const draw = (count: number) => render(
  <Router hook={hook}><MediaSection title="Current season" mediaNodes={Array.from({ length: count }, (_, index) => show(index)) as never}/></Router>,
  document.getElementById('row')!,
)
Object.assign(window, { draw })
