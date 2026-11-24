import { afterEach, expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../../src/worker/resolvers/episode/index'
import { heldViewerLanguages, holdViewerLanguages } from '../../../../../src/viewer-languages'

const initialLanguages = heldViewerLanguages()
afterEach(() => {
  holdViewerLanguages(initialLanguages)
})

const SOURCE = 'A <i>quiet</i> town<script>window.ran = true</script>'
const parent = {
  titles: [
    { language: 'en', title: 'High Priest of Yatan', score: 0.5 },
    { language: 'ja', title: 'ヤタンの祭司長', score: 0.15 },
    { language: 'fr', title: 'Grand Pretre de Yatan', score: 0.05, class: 'TRANSLATED' },
  ],
  descriptions: [{ language: 'en', description: SOURCE }, { language: 'ja', description: SOURCE }],
  shortDescriptions: [{ language: 'en', shortDescription: SOURCE }, { language: 'ja', shortDescription: SOURCE }],
}
const field = (name: 'descriptions' | 'shortDescriptions', input?: { type?: 'HTML' | 'TEXT', count?: number }) =>
  (resolvers.Episode[name] as any)(parent, { input })

test('episode titles keep score order for English, put Japanese first for Japanese viewers, and prioritize matching translations', () => {
  holdViewerLanguages({ language: 'en-US' })
  expect(((resolvers.Episode as any).titles(parent) as { language: string }[]).map(t => t.language)).toEqual(['en', 'ja', 'fr'])

  holdViewerLanguages({ language: 'ja-JP' })
  expect(((resolvers.Episode as any).titles(parent) as { language: string }[]).map(t => t.language)).toEqual(['ja', 'en', 'fr'])

  holdViewerLanguages({ language: 'fr-FR' })
  expect(((resolvers.Episode as any).titles(parent) as { language: string }[]).map(t => t.language)).toEqual(['fr', 'en', 'ja'])
})

test('an episode answers its descriptions in the form asked for, in the field the schema reads', () => {
  expect(field('descriptions', { type: 'HTML', count: 1 })).toEqual([{ language: 'en', description: 'A <i>quiet</i> town' }])
  expect(field('shortDescriptions', { type: 'HTML', count: 1 })).toEqual([{ language: 'en', shortDescription: 'A <i>quiet</i> town' }])
  for (const input of [{ type: 'TEXT' as const }, undefined]) {
    expect(field('descriptions', input).map((item: any) => item.description.trim())).toEqual(['A quiet town', 'A quiet town'])
    expect(field('shortDescriptions', input).map((item: any) => item.shortDescription.trim())).toEqual(['A quiet town', 'A quiet town'])
  }
})
