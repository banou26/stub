import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vite-plus/test'

// a plain .mjs beside the other build scripts, so its exports arrive untyped
import { APP_MANIFEST, appIconProblems } from '../../scripts/check-npm-entry.mjs'

// fkn.app's package page reads an app's icon only from a web app manifest in the SIGNED release
// contents, fetched through unpkg, so the icon has to ship inside the npm tarball. anime.fkn.app
// serves the same build/ as its origin root, where the html links the manifest and the favicon.

const bytesOf = (path: string) => {
  try {
    return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)))
  } catch {
    return undefined
  }
}

const textOf = (path: string) => bytesOf(path)?.toString('utf8')

const pkg = JSON.parse(textOf('package.json') ?? '{}') as { main: string, files: string[] }

type Icon = { src: string, sizes: string, type: string }
type Manifest = { name: string, short_name: string, theme_color: string, background_color: string, icons: Icon[] }

const manifest = JSON.parse(textOf(`public/${APP_MANIFEST}`) ?? '{}') as Manifest

// what `vp build` makes of the source: index.html at the root of build/, and public/ copied beside it verbatim
const sourceAsBuilt = {
  read: (path: string) => {
    if (!path.startsWith('build/')) return undefined
    const name = path.slice('build/'.length)
    return name === 'index.html' ? textOf('index.html') : textOf(`public/${name}`)
  },
  list: () => [],
}

const pngSizeOf = (bytes: Buffer) => {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  expect(bytes.subarray(12, 16).toString('latin1')).toBe('IHDR')
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
}

describe("stub's app icon", () => {
  test('passes the build gate as the build copies it', () => {
    expect(appIconProblems(pkg, sourceAsBuilt)).toEqual([])
  })

  test('names Stub in the colours of its own page', () => {
    expect(manifest.name).toBe('Stub')
    expect(manifest.short_name).toBe('Stub')
    expect(manifest.theme_color).toBe(manifest.background_color)
    expect(textOf('src/index.tsx')).toContain(`background-color: ${manifest.background_color};`)
    expect(textOf('index.html')).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`)
  })

  // consent-icons.ts on fkn.app refuses an image over 256 KB or 1024 px before redrawing it
  test('ships every png at the size it declares, small enough for fkn.app to redraw', () => {
    const pngs = manifest.icons.filter(icon => icon.type === 'image/png')
    expect(pngs.map(icon => icon.sizes).sort()).toEqual(['192x192', '512x512'])
    for (const icon of pngs) {
      const bytes = bytesOf(`public/${icon.src}`)
      expect(bytes, icon.src).toBeDefined()
      expect(pngSizeOf(bytes!)).toBe(icon.sizes)
      expect(bytes!.length).toBeLessThan(256 * 1024)
    }
  })

  test('serves a real favicon.ico, not the html a missing file falls back to', () => {
    const bytes = bytesOf('public/favicon.ico')
    expect(bytes).toBeDefined()
    expect([...bytes!.subarray(0, 4)]).toEqual([0, 0, 1, 0])
    const count = bytes!.readUInt16LE(4)
    const widths = Array.from({ length: count }, (_, index) => bytes![6 + index * 16])
    expect(widths).toContain(32)
  })
})

type Tree = { read: (path: string) => string | undefined, list: (path: string) => string[] }

const treeOf = (files: Record<string, string>): Tree => ({ read: path => files[path], list: () => [] })

const PACKAGE = { main: 'build/index.js', files: ['build'] }
const HTML = '<link rel="icon" href="/favicon.ico" sizes="32x32" />\n<link rel="manifest" href="/app.webmanifest" />'
const BUILD = {
  'build/app.webmanifest': JSON.stringify({ name: 'App', icons: [{ src: './icons/a.png', sizes: '192x192', type: 'image/png' }] }),
  'build/icons/a.png': 'png',
  'build/favicon.ico': 'ico',
  'build/index.html': HTML,
}

const withIcon = (src: string, type = 'image/png') => ({
  ...BUILD,
  'build/app.webmanifest': JSON.stringify({ name: 'App', icons: [{ src, sizes: '192x192', type }] }),
})

describe('the app icon check', () => {
  test('passes a build that ships a manifest, its icons and a favicon the html links', () => {
    expect(appIconProblems(PACKAGE, treeOf(BUILD))).toEqual([])
  })

  test('refuses a build with no manifest', () => {
    const { 'build/app.webmanifest': _, ...withoutManifest } = BUILD
    expect(appIconProblems(PACKAGE, treeOf(withoutManifest)).join('\n')).toContain('build/app.webmanifest does not exist')
  })

  test('refuses a files list that would leave the manifest or an icon out of the tarball', () => {
    expect(appIconProblems({ ...PACKAGE, files: ['build/index.js'] }, treeOf(BUILD)).join('\n')).toContain('does not publish build/app.webmanifest')
    expect(appIconProblems({ ...PACKAGE, files: ['build/app.webmanifest'] }, treeOf(BUILD)).join('\n')).toContain('does not publish build/icons/a.png')
  })

  test('refuses a manifest that is not json', () => {
    expect(appIconProblems(PACKAGE, treeOf({ ...BUILD, 'build/app.webmanifest': '{' })).join('\n')).toContain('not valid JSON')
  })

  // unpkg serves the package root, so an origin-root '/icons/a.png' resolves outside the release there
  test('refuses an icon named from the origin root rather than the manifest', () => {
    expect(appIconProblems(PACKAGE, treeOf(withIcon('/icons/a.png'))).join('\n')).toContain('not relative to the manifest')
    expect(appIconProblems(PACKAGE, treeOf(withIcon('https://anime.fkn.app/icons/a.png'))).join('\n')).toContain('not relative to the manifest')
  })

  test('refuses an icon the build does not have', () => {
    expect(appIconProblems(PACKAGE, treeOf(withIcon('./icons/b.png'))).join('\n')).toContain('build/icons/b.png is not in the build')
  })

  test('refuses a manifest with no png icon', () => {
    const svgOnly = { ...withIcon('./icons/a.svg', 'image/svg+xml'), 'build/icons/a.svg': '<svg/>' }
    expect(appIconProblems(PACKAGE, treeOf(svgOnly)).join('\n')).toContain('declares no png icon')
  })

  test('refuses html that does not link the manifest', () => {
    const unlinked = { ...BUILD, 'build/index.html': HTML.replace('rel="manifest"', 'rel="preload"') }
    expect(appIconProblems(PACKAGE, treeOf(unlinked)).join('\n')).toContain('does not link /app.webmanifest')
  })

  test('refuses html that links no icon, or one the build does not have', () => {
    const unlinked = { ...BUILD, 'build/index.html': HTML.replace('rel="icon"', 'rel="preload"') }
    expect(appIconProblems(PACKAGE, treeOf(unlinked)).join('\n')).toContain('links no icon')
    const missing = { ...BUILD, 'build/index.html': HTML.replace('/favicon.ico', '/favicon.png') }
    expect(appIconProblems(PACKAGE, treeOf(missing)).join('\n')).toContain("links the icon '/favicon.png'")
  })

  test('refuses a build with no favicon.ico', () => {
    const { 'build/favicon.ico': _, ...withoutFavicon } = BUILD
    expect(appIconProblems(PACKAGE, treeOf(withoutFavicon)).join('\n')).toContain('build/favicon.ico does not exist')
  })
})
