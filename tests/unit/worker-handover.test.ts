// What src/worker.ts hands the worker before the page's first question, and again on every change: here, the
// languages a source added in Settings is handed (src/viewer-languages.ts).
import { expect, test, vi } from 'vite-plus/test'

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
})
vi.stubGlobal('navigator', { languages: ['fr-FR'] })
vi.stubGlobal('location', new URL('http://localhost/'))

// every call the page makes on the worker's api, by name
const handed = vi.hoisted(() => [] as [string, unknown[]][])
vi.mock('../../src/worker/index?worker', () => ({ default: class {} }))
vi.mock('@fkn/lib', () => ({ relayWorker: async () => {} }))
vi.mock('osra', () => ({
  expose: async (_resolvers: unknown, { key }: { key: string }) => key !== 'yoga' ? undefined : new Proxy({}, {
    // not thenable, as the awaited osra api is not
    get: (_, name: string) => name === 'then' ? undefined : async (...args: unknown[]) => { handed.push([name, args]) },
  }),
}))

await import('../../src/worker')
const { keepAudioLanguage, keepSubtitleLanguage } = await import('../../src/utils/track-languages')

const languagesHanded = () => handed.filter(([name]) => name === 'setViewerLanguages').map(([, [languages]]) => languages)

test("the viewer's languages reach the worker at start, and again on each pick", () => {
  expect(languagesHanded()).toEqual([{ language: 'fr-FR' }])
  keepAudioLanguage('Japanese')
  keepSubtitleLanguage(null)
  expect(languagesHanded()).toEqual([{ language: 'fr-FR' }, { language: 'fr-FR', audio: 'ja' }, { language: 'fr-FR', audio: 'ja', subtitles: null }])
})
