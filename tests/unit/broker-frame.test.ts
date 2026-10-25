import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { brokerFrameScript } from '@fkn/lib/broker-frame'
import { expect, test } from 'vite-plus/test'

import { brokerFrame } from '../../scripts/broker-frame'

const ROOT = resolve(import.meta.dirname, '../..')

test('the plugin puts the lib\'s broker frame script at the start of the body', () => {
  const transform = brokerFrame().transformIndexHtml as () => unknown
  expect(transform()).toEqual([{ tag: 'script', children: brokerFrameScript, injectTo: 'body-prepend' }])
})

test('the app build runs the plugin', () => {
  expect(readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf-8')).toMatch(/^\s+brokerFrame\(\),$/m)
})

test.each(['index.html', 'embed.html'])('%s mounts no broker frame of its own', file => {
  expect(readFileSync(resolve(ROOT, file), 'utf-8')).not.toMatch(/<iframe[^>]*\/api/)
})
