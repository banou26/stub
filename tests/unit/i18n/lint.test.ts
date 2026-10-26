// The eslint-plugin-formatjs rules stub's linter runs on each message (vite.config.ts), each on a message that breaks
// it. The cases are linted outside the repo with its config, so the real tree never carries a broken message.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test'

const ROOT = resolve(__dirname, '../../..')

const lint = (paths: string[]) => {
  const { stdout } = spawnSync(join(ROOT, 'node_modules/.bin/vp'), ['lint', '--format', 'json', ...paths], { cwd: ROOT, encoding: 'utf8' })
  const { diagnostics } = JSON.parse(stdout) as { diagnostics: { code: string, filename: string }[] }
  return diagnostics.filter(each => each.code.startsWith('formatjs('))
}

const HEAD = "import { useIntl } from 'react-intl'\nexport const Case = ({ text }: { text: string }) => {\n  const intl = useIntl()\n  return "

const CASES = {
  correct: "<p title={intl.formatMessage({ id: 'Play#verb', defaultMessage: 'Play', description: 'verb' })}>{intl.formatMessage({ id: 'Hi {name}', defaultMessage: 'Hi {name}' }, { name: text })}</p>",
  noId: "<p>{intl.formatMessage({ defaultMessage: 'Play' })}</p>",
  wrongId: "<p>{intl.formatMessage({ id: 'play', defaultMessage: 'Play' })}</p>",
  builtMessage: "<p>{intl.formatMessage({ id: 'Play', defaultMessage: text })}</p>",
  valueMissing: "<p>{intl.formatMessage({ id: 'Hi {name}', defaultMessage: 'Hi {name}' })}</p>",
  notIcu: "<p>{intl.formatMessage({ id: '{count, plural, one {#}', defaultMessage: '{count, plural, one {#}' }, { count: 1 })}</p>",
  spaces: "<p>{intl.formatMessage({ id: 'Hi  there', defaultMessage: 'Hi  there' })}</p>",
} as const

const RULE: Record<Exclude<keyof typeof CASES, 'correct'>, string> = {
  noId: 'formatjs(enforce-id)',
  wrongId: 'formatjs(enforce-id)',
  builtMessage: 'formatjs(enforce-default-message)',
  valueMissing: 'formatjs(enforce-placeholders)',
  notIcu: 'formatjs(no-invalid-icu)',
  spaces: 'formatjs(no-multiple-whitespaces)',
}

let dir: string
let found: Map<string, string[]>
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'stub-i18n-lint-'))
  for (const [name, jsx] of Object.entries(CASES)) writeFileSync(join(dir, `${name}.tsx`), `${HEAD}${jsx}\n}\n`)
  found = new Map()
  for (const { code, filename } of lint([dir])) found.set(basename(filename, '.tsx'), [...found.get(basename(filename, '.tsx')) ?? [], code])
}, 60_000)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('a message written as stub writes them passes', () => {
  expect(found.get('correct')).toBeUndefined()
})

describe('each rule fails its broken message', () => {
  test.each(Object.entries(RULE))('%s: %s', (name, rule) => {
    expect(found.get(name)).toContain(rule)
  })
})
