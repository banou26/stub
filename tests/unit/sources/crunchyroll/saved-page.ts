import type { Frame } from '@fkn/lib'

import { readFileSync } from 'node:fs'
import { parseHTML } from 'linkedom'

/** A Crunchyroll page saved under tests/fixtures/crunchyroll, each with a note on where it came from. */
export const crunchyrollPage = (name: string) =>
  readFileSync(new URL(`../../../fixtures/crunchyroll/${name}`, import.meta.url), 'utf8')

/** A frame on a saved page whose `exists` reads it with querySelectorAll, as frame-locator's `locator` does. */
export const frameOn = (html: string) => {
  const { document } = parseHTML(html)
  return { locator: (selector: string) => ({ exists: async () => document.querySelectorAll(selector).length > 0 }) } as unknown as Frame
}
