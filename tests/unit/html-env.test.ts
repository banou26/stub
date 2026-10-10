import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'vite-plus/test'

// Vite leaves a `%VITE_X%` it has no value for in the built HTML and the build still passes, so a
// production page would frame `%VITE_WEB_ORIGIN%/api` instead of fkn.app's. .env.production is what
// gives the published build its values.

const ROOT = resolve(import.meta.dirname, '../..')
const read = (file: string) => existsSync(resolve(ROOT, file)) ? readFileSync(resolve(ROOT, file), 'utf-8') : ''

test.each(['index.html', 'embed.html'])('every placeholder in %s has a production value', file => {
  const placeholders = [...read(file).matchAll(/%(VITE_\w+)%/g)].map(([, name]) => name)
  expect(placeholders.length, 'the page names a placeholder').toBeGreaterThan(0)
  for (const name of placeholders) expect(read('.env.production')).toMatch(new RegExp(`^${name}=https://`, 'm'))
})
