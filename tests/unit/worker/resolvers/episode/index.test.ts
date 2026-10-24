import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../../src/worker/resolvers/episode/index'

const SOURCE = 'A <i>quiet</i> town<script>window.ran = true</script>'
const parent = {
  descriptions: [{ language: 'en', description: SOURCE }, { language: 'ja', description: SOURCE }],
  shortDescriptions: [{ language: 'en', shortDescription: SOURCE }, { language: 'ja', shortDescription: SOURCE }],
}
const field = (name: 'descriptions' | 'shortDescriptions', input?: { type?: 'HTML' | 'TEXT', count?: number }) =>
  (resolvers.Episode[name] as any)(parent, { input })

test('an episode answers its descriptions in the form asked for, in the field the schema reads', () => {
  expect(field('descriptions', { type: 'HTML', count: 1 })).toEqual([{ language: 'en', description: 'A <i>quiet</i> town' }])
  expect(field('shortDescriptions', { type: 'HTML', count: 1 })).toEqual([{ language: 'en', shortDescription: 'A <i>quiet</i> town' }])
  for (const input of [{ type: 'TEXT' as const }, undefined]) {
    expect(field('descriptions', input).map((item: any) => item.description.trim())).toEqual(['A quiet town', 'A quiet town'])
    expect(field('shortDescriptions', input).map((item: any) => item.shortDescription.trim())).toEqual(['A quiet town', 'A quiet town'])
  }
})
