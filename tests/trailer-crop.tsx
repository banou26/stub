import { render } from 'preact'

import YoutubeMinimalPlayer from '../src/components/yt-minimal-player'

// The page tests/trailer-crop.spec.ts drives: the real player in one box, sized by the query string
// (`?width=700&height=392.5&link`), the way each surface's box holds it.
const query = new URLSearchParams(location.search)

render(
  <div id="box" style={{ position: 'relative', width: Number(query.get('width')), height: Number(query.get('height')) }}>
    <YoutubeMinimalPlayer url="https://www.youtube.com/watch?v=trailer0000" redirectTo={query.has('link') ? '/media' : undefined}/>
  </div>,
  document.body,
)
