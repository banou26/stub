// The store export reaches a page ONLY through `?export=store`, and only as a window function: the
// schema has no field that answers "every cluster in the store" (`Subscription.mediaPage` fuzzy
// merges, hides attached containers, filters and sorts before a caller sees anything), and a query
// field would be permanent product surface plus a second copy of the store in graphcache. A flagged
// window function exists only on a page that asked for it, and its ABSENCE is what tells the exporter
// the flag never reached the app, which otherwise looks exactly like a store holding nothing.
import { readExportFlag } from './utils/export-flag'
import { exportStore } from './worker'

declare global {
  interface Window {
    __stubExportStore?: (options?: { excludeOrigins?: string[] }) => Promise<unknown>
  }
}

if (readExportFlag(location.href)) {
  window.__stubExportStore = options => exportStore(options ?? { excludeOrigins: [] })
}
