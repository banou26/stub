import { expandPath, SHORT_PATH } from './utils/share-link'

// FIRST in src/index.tsx: plugin-url.ts reads the sources a link offers once, as it loads, and from then on writes only
// the sources it knows into every address, so a short link opened after it would lose its `plugins=` and the offer
if (location.pathname.startsWith(SHORT_PATH)) {
  const address = expandPath(location.pathname.slice(SHORT_PATH.length))
  if (address) history.replaceState(history.state, '', address)
}
