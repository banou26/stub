import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

// fkn.app's package page shows the images package.json's fkn field names only for a verified release,
// read from unpkg at the exact version, so they ship in the tarball. The caps are @fkn/package-manifest's
// LISTING_IMAGE_MAX_BYTES, LISTING_IMAGE_MAX_SIDE and SCREENSHOTS_MAX, copied because stub does not
// depend on that package; fkn-sign refuses a release past them.
const MAX_BYTES = 1_048_576
const MAX_SIDE = 3_840
const SCREENSHOTS_MAX = 6

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

const pkg = JSON.parse(readFileSync(root('package.json'), 'utf-8')) as {
  files: string[]
  fkn: { background: string, cover: string, screenshots: string[] }
}
const { background, cover, screenshots } = pkg.fkn
const named = [background, cover, ...screenshots]

// RIFF, a length, WEBP, then a lossy VP8 chunk whose frame header holds 14 bit width and height
const webpSizeOf = (path: string) => {
  const bytes = readFileSync(root(path))
  expect(bytes.subarray(0, 4).toString('latin1'), path).toBe('RIFF')
  expect(bytes.subarray(8, 12).toString('latin1'), path).toBe('WEBP')
  expect(bytes.subarray(12, 16).toString('latin1'), `${path} is not a simple lossy WebP: re-encode it with cwebp -q`).toBe('VP8 ')
  return { bytes: bytes.length, size: `${bytes.readUInt16LE(26) & 0x3fff}x${bytes.readUInt16LE(28) & 0x3fff}` }
}

describe("stub's store listing", () => {
  test('names a background, a cover and one to six screenshots, each a WebP under store/ that npm ships', () => {
    expect(screenshots.length).toBeGreaterThanOrEqual(1)
    expect(screenshots.length).toBeLessThanOrEqual(SCREENSHOTS_MAX)
    expect(new Set(named).size).toBe(named.length)
    expect(pkg.files).toContain('store')
    for (const path of named) expect(path).toMatch(/^store\/[a-z0-9-]+\.webp$/)
  })

  // what is in store/ ships whether or not the listing names it
  test('ships no image the listing does not name', () => {
    expect(readdirSync(root('store')).map(name => `store/${name}`).sort()).toEqual([...named].sort())
  })

  test('keeps every image within the caps fkn.app and the signer hold it to', () => {
    for (const path of named) {
      const { bytes, size } = webpSizeOf(path)
      expect(bytes, path).toBeLessThanOrEqual(MAX_BYTES)
      for (const side of size.split('x').map(Number)) expect(side, path).toBeLessThanOrEqual(MAX_SIDE)
    }
  })

  // the background is Steam's library hero size, the cover its 2:3 capsule, and the screenshots
  // 1280x800 captures of anime.fkn.app at a device pixel ratio of 2
  test('draws each image at the size its place on the page recommends', () => {
    expect(webpSizeOf(background).size).toBe('3840x1240')
    expect(webpSizeOf(cover).size).toBe('600x900')
    for (const path of screenshots) expect(webpSizeOf(path).size, path).toBe('2560x1600')
  })
})
