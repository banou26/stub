import type { Page } from '@playwright/test'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILES = join(import.meta.dirname, '..', 'node_modules', '@fontsource-variable', 'montserrat')
const RANGES: Record<string, string> = JSON.parse(readFileSync(join(FILES, 'unicode.json'), 'utf8'))
const FACES = Object.entries(RANGES).flatMap(([subset, unicodeRange]) => (['normal', 'italic'] as const).map(style => ({
  style, unicodeRange, data: readFileSync(join(FILES, 'files', `montserrat-${subset}-wght-${style}.woff2`)).toString('base64'),
})))

/**
 * Draws the page in the Montserrat its viewers get, offline. A spec refuses fonts.googleapis.com, so without this its
 * text falls to the machine's own sans-serif, which is DejaVu Sans on GitHub's runner and Noto Sans on a NixOS desktop.
 * fontsource ships Google's own files by subset and unicode-range (5.3.0's ten are byte for byte Google's v31,
 * checked 2026-11-02), and a FontFace made from bytes is loaded as it is made, so the first frame is already drawn in
 * Montserrat, with no swap for a measurement to catch.
 */
export const drawMontserrat = (page: Page) => page.addInitScript(faces => {
  for (const { data, ...descriptors } of faces) {
    document.fonts.add(new FontFace('Montserrat', Uint8Array.from(atob(data), char => char.charCodeAt(0)), { ...descriptors, weight: '100 900' }))
  }
}, FACES)
