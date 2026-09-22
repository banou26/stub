import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// stub is a MANAGED app since 2026-09-23 (HOR-224 slice 6): it holds no key, and its npm source is
// claimed by this field, which the api reads from registry.npmjs.org/@banou%2fstub/latest and
// compares with EXACT equality. A wrong id reads as another app's claim, and a missing one leaves the
// source pending with every gate green, so both are pinned here rather than noticed at Check now.

// the id the console minted for Stub; its website, anime.fkn.app, claims the same one by TXT record
const APP = 'fkn:app:1opu7jofekzvrc4cuyx4hgbhhn6ifzzqsgi5asopkshqvmznbxfda'
// the signed app the claim replaced, revoked 2026-09-19 and still quoted in older notes
const RETIRED = 'fkn:app:1mv4iei5nrldfysclsmkxnadt4a2y3k6y7rsln6hkawsuep7bo3vq'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8')) as {
  name: string
  files: string[]
  fkn?: unknown
}

test('package.json claims the managed Stub app, and only that', () => {
  expect(pkg.name).toBe('@banou/stub')
  // the whole object, so a reserved key riding along is caught too
  expect(pkg.fkn).toEqual({ app: APP })
})

test('the claim is a managed app id, and not the retired signed one', () => {
  expect(APP).toMatch(/^fkn:app:1[a-z2-7]{52}$/)
  expect(APP).not.toBe(RETIRED)
})

// a package carries the claim or a signed fkn.json, never both: the device reads the field as
// "this package ships no manifest"
test('no fkn.json is published beside the claim', () => {
  expect(pkg.files).not.toContain('fkn.json')
})
