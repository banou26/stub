import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'vite-plus/test'

import config from '../../../vite.preview.config'
import { commit } from '../../../vite.config'

const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../package.json'), 'utf8')) as { version: string }

test('the preview build names stub\'s version and commit, which its inbox lines carry as their writer', () => {
  expect(commit).toMatch(/^([0-9a-f]{7}|dev)$/)
  expect(config.define).toMatchObject({ __STUB_VERSION__: JSON.stringify(version), __STUB_COMMIT__: JSON.stringify(commit) })
})
