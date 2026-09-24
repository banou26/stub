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
  test('outlasts its retry windows, with the build and the publish still to pay for', () => {
    // the registry's, and the device check's after it (slice 9)
    const loops = [...steps.matchAll(/for attempt in \$\(seq 1 (\d+)\)[\s\S]*?sleep (\d+)/g)]
    expect(loops.length, 'a retry loop moved or changed shape, so the sum below is not the job budget').toBe(2)
    const waiting = loops.reduce((total, loop) => total + Number(loop[1]) * Number(loop[2]), 0)
    const timeout = steps.match(/timeout-minutes: (\d+)/)
    expect(timeout, 'the job declares no timeout, so a hung step runs for the runner maximum').toBeTruthy()
    expect(Number(timeout![1]) * 60 - waiting, 'seconds left for checkout, npm ci, the build and the publish').toBeGreaterThanOrEqual(15 * 60)
  })
})

// HOR-233 slice 9: every release is signed in place, and devices check it after it is served
describe('the in-place signature', () => {
  const names = [...steps.matchAll(/- name: (.+)/g)].map((match) => match[1]!.trim())
  const block = (name: string) => {
    const at = steps.indexOf(`- name: ${name}`)
    const next = steps.indexOf('- name: ', at + 1)
    return steps.slice(at, next === -1 ? undefined : next)
  }

  // proof: move the sign step after Publish and the release npm serves carries no fkn.json
  test('signs after the build and before the publish, with the key CI holds', () => {
    expect(names.indexOf('Sign the package in place')).toBeGreaterThan(names.indexOf('Build'))
    expect(names.indexOf('Sign the package in place')).toBeLessThan(names.indexOf('Publish'))
    expect(names.indexOf("Fetch Stub's key list")).toBeLessThan(names.indexOf('Sign the package in place'))
    const sign = block('Sign the package in place')
    expect(sign).toContain('FKN_RELEASE_KEY: ${{ secrets.FKN_RELEASE_KEY }}')
    expect(sign).toContain('npx --yes @fkn/sign@0.0.10 release . --npm --list "$RUNNER_TEMP/fkn-keys.json"')
    expect(block("Fetch Stub's key list")).toContain('set -o pipefail; curl -fsS https://api.fkn.app/v1/apps/fkn:app:173elff365hgaijng4mufbd4zo6lypfskb3zdd5jkpgd4hj4ovjjq/keys | jq .list > "$RUNNER_TEMP/fkn-keys.json"')
    for (const name of ["Fetch Stub's key list", 'Sign the package in place', 'Confirm devices verify it']) {
      expect(block(name), name).toContain("if: steps.decide.outputs.changed == 'true'")
    }
  })

  // exit 2 is "unpkg does not serve every file yet", the only answer worth waiting out
  test('checks what devices check once the registry serves it, retrying only while unpkg catches up', () => {
    expect(names.indexOf('Confirm devices verify it')).toBeGreaterThan(names.indexOf('Confirm the registry serves it'))
    const verify = block('Confirm devices verify it')
    expect(verify).toContain('npx --yes @fkn/sign@0.0.10 verify "npm:@banou/stub@$VERSION" --list "$RUNNER_TEMP/fkn-keys.json"')
    expect(verify).toContain('if [ "$CODE" != "2" ]; then exit "$CODE"; fi')
  })
})
