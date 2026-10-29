import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, expect, test, vi } from 'vite-plus/test'

const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../package.json'), 'utf8')) as { version: string }

afterEach(() => {
  vi.unstubAllEnvs()
})

test('the preview build names stub\'s version and 8 characters of its commit, as the Offline history job\'s writer, and the page 7', async () => {
  vi.stubEnv('CF_PAGES_COMMIT_SHA', '5e622015c3a9b7d1e4f60a2b8c9d0e1f2a3b4c5d')
  vi.resetModules()
  const [{ default: config }, { commit }] = await Promise.all([import('../../../vite.preview.config'), import('../../../vite.config')])
  expect(config.define).toMatchObject({ __STUB_VERSION__: JSON.stringify(version), __STUB_COMMIT__: '"5e622015"' })
  expect(commit).toBe('5e62201')
})
