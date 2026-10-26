import type { Env } from '../../../api/src/index'

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vite-plus/test'
import { experimental_readRawConfig, unstable_readConfig } from 'wrangler'

import apiBuild from '../../../vite.api.config'

type Quiet = {
  observability?: { enabled?: boolean, logs?: { enabled?: boolean }, traces?: { enabled?: boolean } }
  logpush?: boolean
  tail_consumers?: unknown[]
  streaming_tail_consumers?: unknown[]
}

const config = fileURLToPath(new URL('../../../api/wrangler.jsonc', import.meta.url))

// a Workers log line records "<METHOD> <URL>", and nothing about who asks the API may be kept
const expectQuiet = (resolved: Quiet, where: string) => {
  expect(resolved.observability?.enabled, `${where}: observability.enabled`).toBe(false)
  expect(resolved.observability?.logs?.enabled, `${where}: observability.logs.enabled`).not.toBe(true)
  expect(resolved.observability?.traces?.enabled, `${where}: observability.traces.enabled`).not.toBe(true)
  expect(resolved.logpush, `${where}: logpush`).not.toBe(true)
  expect(resolved.tail_consumers ?? [], `${where}: tail_consumers`).toEqual([])
  expect(resolved.streaming_tail_consumers ?? [], `${where}: streaming_tail_consumers`).toEqual([])
}

test('keeps request logging off in every environment wrangler would deploy', () => {
  expectQuiet(unstable_readConfig({ config }), 'top level')
  const { rawConfig } = experimental_readRawConfig({ config }) as { rawConfig: { env?: Record<string, unknown>, previews?: Quiet } }
  for (const env of Object.keys(rawConfig.env ?? {})) expectQuiet(unstable_readConfig({ config, env }), `env.${env}`)
  if (rawConfig.previews?.observability) expect(rawConfig.previews.observability.enabled, 'previews: observability.enabled').toBe(false)
})

test('is reached only on api.stub.banou.dev, never on workers.dev', () => {
  const resolved = unstable_readConfig({ config })
  expect(resolved.name).toBe('stub-api')
  expect(resolved.workers_dev).toBe(false)
  expect(resolved.preview_urls).toBe(false)
  expect(resolved.routes).toEqual([{ pattern: 'api.stub.banou.dev', custom_domain: true }])
})

test('deploys what vite.api.config.ts builds, with the bindings the Worker reads', () => {
  const resolved = unstable_readConfig({ config })
  const { outDir, lib } = apiBuild.build as { outDir: string, lib: { fileName: () => string } }
  expect(resolved.main).toBe(resolve(outDir, lib.fileName()))
  const bindings: (keyof Env)[] = ['STORE', 'LIMIT']
  expect([...resolved.kv_namespaces.map(({ binding }) => binding), ...resolved.ratelimits.map(({ name }) => name)]).toEqual(bindings)
  expect(resolved.ratelimits[0]?.simple).toEqual({ limit: 1000, period: 60 })
})
