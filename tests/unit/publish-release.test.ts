// The publish workflow signs fkn.json TWICE per release and the two documents are not
// interchangeable. The every-push half signs identity only and COMMITS the result, which is the file
// Cloudflare Pages deploys to anime.fkn.app. The version-change half signs a `contents` list over
// the npm packlist and never commits it, because those bytes are the tarball's rather than the
// website's: a list on the committed copy would name files anime.fkn.app does not serve, and every
// load from that source would be refused for a file that was never wrong.
//
// Nothing here can be seen before a release. A list built from the wrong tree, built before the
// build, or missing the source it is fetched from publishes successfully and fails at every
// consumer, on a version number that npm reserves forever by then.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { MANIFEST_MAX_BYTES, verifyManifest } from '@fkn/sign'

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf-8')

const workflow = read('.github/workflows/publish-lib.yml')

/**
 * The workflow WITHOUT its comments, which every assertion about its steps has to read: the file
 * explains each trap it avoids by name, so `--contents` and `git commit` both appear in prose
 * whether or not the step using them survives an edit.
 */
const steps = workflow
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n')

/** Where a command sits in the job, for the assertions that are about ORDER rather than presence. */
const positionOf = (needle: string): number => {
  const index = steps.indexOf(needle)
  expect(index, `${needle} is not in publish-lib.yml, so an order assertion over it would be vacuous`).toBeGreaterThan(-1)
  return index
}

/**
 * One step's shell, dedented, as bash receives it. Read from the RAW workflow rather than the
 * comment-stripped copy above, because a shell comment inside a `run` body is part of the script.
 */
const scriptOf = (name: string): string => {
  const step = workflow.indexOf(`- name: ${name}\n`)
  expect(step, `no step named '${name}', so a behaviour assertion over its shell would be vacuous`).toBeGreaterThan(-1)
  const block = workflow.indexOf('run: |', step)
  expect(block, `the step named '${name}' runs no inline shell`).toBeGreaterThan(-1)
  const lines: string[] = []
  for (const line of workflow.slice(block).split('\n').slice(1)) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(10))) break
    lines.push(line.slice(10))
  }
  return `${lines.join('\n')}\n`
}

/** What one `fkn-sign verify --published` attempt answers: its exit code and the line it writes. */
type Answer = { code: number, stderr: string }

/**
 * Runs a step's shell against a scripted `fkn-sign`, and reports how many attempts it made.
 *
 * `npx` and `sleep` are both replaced on PATH: the first hands back the next scripted answer and
 * counts the call, the second returns at once so a forty attempt loop costs no wall clock. The
 * ATTEMPT COUNT is the measurement, since a loop that reaches the same red forty attempts later
 * still exits non-zero and would pass an assertion about the exit code alone.
 */
const attemptsOf = (script: string, answers: Answer[], env: Record<string, string>): { code: number, attempts: number } => {
  const root = mkdtempSync(join(tmpdir(), 'stub-publish-'))
  const bin = join(root, 'bin')
  const scripted = join(root, 'answers')
  mkdirSync(bin)
  mkdirSync(scripted)
  for (const [index, answer] of answers.entries()) writeFileSync(join(scripted, String(index + 1)), `${answer.code}\n${answer.stderr}\n`)
  const last = answers[answers.length - 1] as Answer
  writeFileSync(join(scripted, 'rest'), `${last.code}\n${last.stderr}\n`)
  const calls = join(root, 'calls')
  writeFileSync(calls, '0\n')
  writeFileSync(join(bin, 'npx'), [
    '#!/bin/sh',
    `n=$(($(cat ${calls}) + 1))`,
    `echo "$n" > ${calls}`,
    `answer=${scripted}/$n`,
    `[ -f "$answer" ] || answer=${scripted}/rest`,
    'tail -n +2 "$answer" >&2',
    'exit "$(head -n 1 "$answer")"',
    '',
  ].join('\n'), { mode: 0o755 })
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const file = join(root, 'step.sh')
  writeFileSync(file, script)
  const run = spawnSync('bash', [file], {
    encoding: 'utf8',
    env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH ?? ''}`, RUNNER_TEMP: root },
  })
  return { code: run.status ?? -1, attempts: Number(readFileSync(calls, 'utf8').trim()) }
}

/** Every `fkn-sign sign` invocation in the job, in the order the steps run. */
const signCommands = [...steps.matchAll(/fkn-sign sign [^\n]*/g)].map((match) => match[0])

describe('the two halves sign different documents', () => {
  test('found the workflow at all, so a false pass here is not a bad path', () => {
    expect(steps, 'publish-lib.yml was not read, so every assertion below is vacuous').toContain('runs-on')
    expect(signCommands, 'a release signs once for the website and once for the tarball').toHaveLength(2)
  })

  test('the committed half stays identity only, since the website is not the packlist', () => {
    expect(signCommands[0], 'the every-push half is the document anime.fkn.app serves').not.toContain('--contents')
  })

  test('the listed half is signed after the commit, so nothing lists a packlist on main', () => {
    expect(positionOf('git push origin HEAD:main')).toBeLessThan(positionOf('fkn-sign sign --contents'))
  })

  test('the listed half is signed after the build, since the list is that build output', () => {
    expect(positionOf('fkn-sign sign --contents')).toBeGreaterThan(positionOf('run: npm run build'))
  })

  test('the listed half names both sources, and the npm one it is fetched from', () => {
    // a source left out is SOURCE_NOT_LISTED at every consumer, on a version that is spent by then
    expect(signCommands[1]).toContain('--sources npm:@banou/stub,https:anime.fkn.app')
    expect(signCommands[1]).toContain('--out fkn.json')
  })
})

describe('what the release is read against before it is uploaded', () => {
  const publish = () => positionOf('run: npm publish --access public')

  test('re-places the copies, so all three carry the list and not the committed document', () => {
    expect(positionOf('fkn-sign place --out build')).toBeLessThan(publish())
  })

  test('re-hashes the tree the list was built from, and asserts the source it lists', () => {
    expect(positionOf('npx fkn-sign check')).toBeLessThan(publish())
    expect(positionOf('fkn-sign verify fkn.json --contents . --source npm:@banou/stub')).toBeLessThan(publish())
    expect(positionOf('node -e'), 'the source assertion runs after the publish, which is too late').toBeLessThan(publish())
  })

  test('holds the document under the cap the deployed readers read it at', () => {
    // 0.0.20 verifies under the readers live today because they ignore `contents` entirely. They
    // still cap the document, and past the cap they refuse it outright rather than degrading.
    const gate = steps.match(/SIZE=\$\(wc -c < fkn\.json\)[\s\S]*?-gt (\d+)/)
    expect(gate, 'the size gate moved or changed shape').toBeTruthy()
    expect(Number(gate![1])).toBe(MANIFEST_MAX_BYTES)
  })

  test('verifies what the CDN serves, which is the only reading of the published bytes', () => {
    expect(positionOf('npx fkn-sign verify --published')).toBeGreaterThan(positionOf('the registry still does not serve'))
  })

  /**
   * The job has to outlast every wait it is allowed to perform, and the expensive half of a release
   * is already paid for by the time the first of them starts. A timeout expiring PAST `npm publish`
   * spends the version number and leaves its published bytes unread: the gate answers changed=false
   * on a dispatch re-run, so none of the release steps run again.
   */
  test('outlasts both retry windows, with the build and the publish still to pay for', () => {
    const loops = [...steps.matchAll(/for attempt in \$\(seq 1 (\d+)\)[\s\S]*?sleep (\d+)/g)]
    expect(loops.length, 'a retry loop moved or changed shape, so the sum below is not the job budget').toBe(2)
    const waiting = loops.reduce((total, loop) => total + Number(loop[1]) * Number(loop[2]), 0)
    const timeout = steps.match(/timeout-minutes: (\d+)/)
    expect(timeout, 'the job declares no timeout, so a hung step runs for the runner maximum').toBeTruthy()
    expect(Number(timeout![1]) * 60 - waiting, 'seconds left for checkout, npm ci, the build and the publish').toBeGreaterThanOrEqual(15 * 60)
  })
})

/**
 * The published verify retries the CDN being behind and nothing else. Two answers wear the same exit
 * code and mean opposite things: a 404 is the CDN not having mirrored the version yet, and a
 * `mismatch` is a final reading of bytes that are already published and cannot change. Retrying the
 * second spends ten minutes reaching the red the first attempt already had, under forty lines
 * claiming the CDN is behind.
 *
 * Driven rather than read: the step's shell runs against a scripted `fkn-sign`, and the ATTEMPT
 * COUNT is what separates the two, since both paths end with the job red.
 */
describe('how the published verify answers', () => {
  const step = () => scriptOf('Verify the published files against the list')
  const env = { VERSION: '0.0.20' }

  test('read the step at all, so a false pass here is not an empty script', () => {
    expect(step(), 'nothing was extracted, so every run below would exit 0 having done nothing').toContain('fkn-sign verify --published')
  })

  test('stops on a mismatch, which is the final answer about bytes that are already served', () => {
    const run = attemptsOf(step(), [{ code: 1, stderr: 'mismatch assets/index.js at https://unpkg.com/@banou/stub@0.0.20' }], env)
    expect(run.attempts, 'the CDN answered about the bytes, so a second reading answers the same').toBe(1)
    expect(run.code, 'a mismatch has to fail the job').not.toBe(0)
  })

  test('stops on an unlisted path, for the same reason', () => {
    const run = attemptsOf(step(), [{ code: 1, stderr: 'unlisted assets/stray.js at https://unpkg.com/@banou/stub@0.0.20: the list does not name it' }], env)
    expect(run.attempts).toBe(1)
    expect(run.code).not.toBe(0)
  })

  test('stops on a version the list does not carry, which no wait can change', () => {
    const run = attemptsOf(step(), [{ code: 1, stderr: 'CONTENTS_VERSION: the list names 0.0.19, not 0.0.20' }], env)
    expect(run.attempts).toBe(1)
    expect(run.code).not.toBe(0)
  })

  test('waits out a 404, which is the CDN behind rather than an answer about the bytes', () => {
    const run = attemptsOf(step(), [
      { code: 1, stderr: 'https://unpkg.com/@banou/stub@0.0.20/fkn.json answered 404' },
      { code: 1, stderr: 'https://unpkg.com/@banou/stub@0.0.20/fkn.json answered 404' },
      { code: 0, stderr: '' },
    ], env)
    expect(run.attempts, 'a fix that stops on every refusal makes the CDN lag a failure').toBe(3)
    expect(run.code).toBe(0)
  })

  test('waits out a CDN that is not answering at all, in either shape', () => {
    const unreachable = attemptsOf(step(), [
      { code: 1, stderr: 'https://unpkg.com/@banou/stub@0.0.20/fkn.json is unreachable: fetch failed' },
      { code: 0, stderr: '' },
    ], env)
    expect(unreachable.attempts).toBe(2)
    expect(unreachable.code).toBe(0)
    const overloaded = attemptsOf(step(), [
      { code: 1, stderr: 'https://unpkg.com/@banou/stub@0.0.20/?meta answered 503' },
      { code: 0, stderr: '' },
    ], env)
    expect(overloaded.attempts).toBe(2)
    expect(overloaded.code).toBe(0)
  })

  test('gives up when the CDN never catches up, rather than passing the release', () => {
    const run = attemptsOf(step(), [{ code: 1, stderr: 'https://unpkg.com/@banou/stub@0.0.20/fkn.json answered 404' }], env)
    expect(run.attempts, 'the whole retry budget').toBe(40)
    expect(run.code).not.toBe(0)
  })
})

describe('the manifest this branch carries', () => {
  test('lists no files, because anime.fkn.app serves a site rather than a tarball', () => {
    const result = verifyManifest(read('fkn.json').trim(), { now: Math.floor(Date.now() / 1000), webOrigin: 'https://fkn.app' })
    if (!result.ok || result.kind !== 'manifest') throw new Error(`fkn.json did not verify: ${result.ok ? result.kind : result.code}`)
    expect(result.contents, 'a committed list names npm paths the website does not serve').toBeNull()
  })
})
