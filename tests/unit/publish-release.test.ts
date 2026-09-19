import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/publish-lib.yml', import.meta.url)), 'utf-8')

// without its comments, which describe the retry window and the timeout in prose
const steps = workflow
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n')

describe('the publish job budget', () => {
  /**
   * The job has to outlast every wait it is allowed to perform, and the expensive half of a release
   * is already paid for by the time the wait starts. A timeout expiring PAST `npm publish` spends the
   * version number and leaves its serving unconfirmed: the gate answers changed=false on a dispatch
   * re-run, so none of the release steps run again.
   */
  test('outlasts its retry window, with the build and the publish still to pay for', () => {
    const loops = [...steps.matchAll(/for attempt in \$\(seq 1 (\d+)\)[\s\S]*?sleep (\d+)/g)]
    expect(loops.length, 'a retry loop moved or changed shape, so the sum below is not the job budget').toBe(1)
    const waiting = loops.reduce((total, loop) => total + Number(loop[1]) * Number(loop[2]), 0)
    const timeout = steps.match(/timeout-minutes: (\d+)/)
    expect(timeout, 'the job declares no timeout, so a hung step runs for the runner maximum').toBeTruthy()
    expect(Number(timeout![1]) * 60 - waiting, 'seconds left for checkout, npm ci, the build and the publish').toBeGreaterThanOrEqual(15 * 60)
  })
})
