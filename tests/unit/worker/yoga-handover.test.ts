// What the worker does with what src/worker.ts hands it (../worker-handover.test.ts): here, the merge order, and the
// viewer's languages held for every plugin resolver's context (./plugin-context.test.ts).
import { expect, test, vi } from 'vite-plus/test'

vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))
vi.stubGlobal('location', new URL('http://localhost/'))

const { osraResolvers } = await import('../../../src/worker/yoga')
const { heldViewerLanguages } = await import('../../../src/viewer-languages')
const { heldMergeOrder } = await import('../../../src/sources/merge-order')

test('the merge order the page hands the worker is the one held', async () => {
  await osraResolvers.setMergeOrder(['anilist', 'mal'])
  expect(heldMergeOrder()).toEqual(['anilist', 'mal'])
})

test('the languages the page hands the worker are the ones held', () => {
  osraResolvers.setViewerLanguages({ language: 'ko-KR', audio: 'ja', subtitles: 'ko' })
  expect(heldViewerLanguages()).toEqual({ language: 'ko-KR', audio: 'ja', subtitles: 'ko' })
})
