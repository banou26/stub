import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vite-plus/test'

const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/publish-lib.yml', import.meta.url)), 'utf-8')

// without its comments, which describe the retry window and the timeout in prose
const steps = workflow
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n')

// each job's text by its id, from its two-space `id:` line under `jobs:` to the next one
const jobs: Record<string, string> = Object.fromEntries(
  steps
    .slice(steps.indexOf('\njobs:\n'))
    .split(/\n(?= {2}[\w-]+:\n)/)
    .slice(1)
    .map((job) => [job.trim().split(':')[0]!, job]),
)
const publish = jobs.publish ?? ''
const header = (job: string) => job.slice(0, job.indexOf('\n    steps:'))

const retries = (text: string) => [...text.matchAll(/for attempt in \$\(seq 1 (\d+)\)[\s\S]*?sleep (\d+)/g)]

describe('the job budgets', () => {
  /**
   * Every job has to outlast every wait it is allowed to perform, and the expensive half of a release
   * is already paid for by the time the publish job's waits start. A timeout expiring PAST `npm publish`
   * spends the version number and leaves its serving unconfirmed: the decide job answers changed=false
   * on a dispatch re-run, so the publish job does not run again.
   */
  test('each outlasts its retry windows, the publish job with the build and the publish still to pay for', () => {
    // the registry's, and the device check's after it (slice 9)
    expect(retries(publish).length, 'a retry loop moved or changed shape, so the sum below is not the publish job budget').toBe(2)
    expect(Object.keys(jobs), 'the jobs as this file reads them').toEqual(['decide', 'publish'])
    expect(jobs.decide, 'the step whose output the publish gate reads').toContain('\n        id: decide\n')
    for (const [id, job] of Object.entries(jobs)) {
      const waiting = retries(job).reduce((total, loop) => total + Number(loop[1]) * Number(loop[2]), 0)
      const timeout = header(job).match(/timeout-minutes: (\d+)/)
      expect(timeout, `the ${id} job declares no timeout, so a hung step runs for the runner maximum`).toBeTruthy()
      // for the publish job's checkout, npm ci, build, signature and publish
      const reserve = id === 'publish' ? 15 * 60 : 0
      expect(Number(timeout![1]) * 60 - waiting, `seconds the ${id} job has left after its retry windows`).toBeGreaterThanOrEqual(reserve)
    }
  })
})

// HOR-233 slice 9: every release is signed in place, and devices check it after it is served
describe('the in-place signature', () => {
  const names = [...publish.matchAll(/- name: (.+)/g)].map((match) => match[1]!.trim())
  const block = (name: string) => {
    const at = publish.indexOf(`- name: ${name}`)
    const next = publish.indexOf('- name: ', at + 1)
    return publish.slice(at, next === -1 ? undefined : next)
  }

  // proof: move the sign step after Publish and the release npm serves carries no fkn.json
  test('signs after the build and before the publish, with the key CI holds', () => {
    expect(names.indexOf('Sign the package in place')).toBeGreaterThan(names.indexOf('Build'))
    expect(names.indexOf('Sign the package in place')).toBeLessThan(names.indexOf('Publish'))
    expect(names.indexOf("Fetch Stub's key list")).toBeLessThan(names.indexOf('Sign the package in place'))
    const sign = block('Sign the package in place')
    expect(sign).toContain('FKN_RELEASE_KEY: ${{ secrets.FKN_RELEASE_KEY }}')
    expect(sign).toContain('npx --yes @fkn/sign@0.0.16 release . --npm --list "$RUNNER_TEMP/fkn-keys.json"')
    expect(block("Fetch Stub's key list")).toContain('set -o pipefail; curl -fsS https://api.fkn.app/v1/apps/fkn:app:173elff365hgaijng4mufbd4zo6lypfskb3zdd5jkpgd4hj4ovjjq/keys | jq .list > "$RUNNER_TEMP/fkn-keys.json"')
    // the decision gates the whole publish job, so these run only for a version the registry lacks
    for (const name of ["Fetch Stub's key list", 'Sign the package in place', 'Confirm devices verify it']) {
      expect(names, name).toContain(name)
      expect(block(name), `${name} has a condition of its own`).not.toMatch(/^\s+if:/m)
    }
    const gate = header(publish)
    expect(gate).toContain('\n    needs: decide\n')
    expect(gate).toContain("\n    if: needs.decide.outputs.changed == 'true'\n")
    expect(jobs.decide).toContain('\n      changed: ${{ steps.decide.outputs.changed }}\n')
  })

  // exit 2 is "unpkg does not serve every file yet", the only answer worth waiting out
  test('checks what devices check once the registry serves it, retrying only while unpkg catches up', () => {
    expect(names.indexOf('Confirm devices verify it')).toBeGreaterThan(names.indexOf('Confirm the registry serves it'))
    const verify = block('Confirm devices verify it')
    expect(verify).toContain('npx --yes @fkn/sign@0.0.16 verify "npm:@banou/stub@$VERSION" --list "$RUNNER_TEMP/fkn-keys.json"')
    expect(verify).toContain('if [ "$CODE" != "2" ]; then exit "$CODE"; fi')
  })
})
