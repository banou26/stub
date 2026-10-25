import type { Plugin } from 'vite-plus'

import { dirname, join, resolve } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const BROWSER_FETCH = join(ROOT, 'src', 'worker', 'browser-fetch')

/**
 * A rig build's `worker.plugins`: the worker's browser fetch becomes ./fake-browser-fetch.ts. A build's own `plugins`
 * reach the page's bundle alone, never the worker's.
 */
export const workerFakes = (): Plugin[] => [{
  name: 'spec-worker-fakes',
  enforce: 'pre',
  resolveId: (source, importer) => importer && resolve(dirname(importer), source) === BROWSER_FETCH ? join(ROOT, 'tests', 'fake-browser-fetch.ts') : undefined,
}]
