// The failure this guards is a relation added to the schema and forgotten here, which renders as raw
// SCREAMING_SNAKE in the middle of the page. Nothing throws, and it looks like a data problem.
import { describe, expect, test } from 'vite-plus/test'
import { readFileSync } from 'node:fs'

import { relationLabel, relationRank, workFormatLabel } from '../../../src/utils/relation-labels'

/** The enum as the schema actually declares it, read rather than restated so the two cannot drift. */
const schemaRelations = (): string[] => {
  const schema = readFileSync(new URL('../../../src/worker/resolvers/media/schema.gql', import.meta.url), 'utf-8')
  const block = schema.match(/enum MediaRelation \{([\s\S]*?)\n\}/)
  if (!block) throw new Error('MediaRelation is not in the schema any more, so this test is measuring nothing')
  return [...block[1]!.matchAll(/^\s*([A-Z_]+)\s*$/gm)].map(match => match[1]!)
}

describe('relationLabel', () => {
  test('every relation the schema declares has wording of its own', () => {
    const relations = schemaRelations()
    expect(relations.length).toBeGreaterThan(5)
    // OTHER is the catch-all, so anything else falling back to its wording is a value nobody wrote
    const missing = relations.filter(relation => relation !== 'OTHER' && relationLabel(relation) === relationLabel('OTHER'))
    expect(missing, 'add these to RELATIONS in src/utils/relation-labels.ts').toEqual([])
  })

  test('and none of it is left as the enum spelled it', () => {
    for (const relation of schemaRelations()) {
      expect(relationLabel(relation), relation).not.toMatch(/[A-Z]{2,}|_/)
    }
  })

  test('reads the way the sites a viewer already uses read', () => {
    expect(relationLabel('SEQUEL')).toBe('Sequel')
    expect(relationLabel('SIDE_STORY')).toBe('Side story')
    expect(relationLabel('SPIN_OFF')).toBe('Spin off')
    expect(relationLabel('SOURCE')).toBe('Source')
  })

  test('each relation the schema declares, word for word', () => {
    expect(Object.fromEntries(schemaRelations().map(relation => [relation, relationLabel(relation)]))).toEqual({
      ADAPTATION: 'Adaptation', PREQUEL: 'Prequel', SEQUEL: 'Sequel', PARENT: 'Parent story', SIDE_STORY: 'Side story',
      CHARACTER: 'Character', SUMMARY: 'Summary', ALTERNATIVE: 'Alternative', SPIN_OFF: 'Spin off', OTHER: 'Related',
      SOURCE: 'Source', COMPILATION: 'Compilation', CONTAINS: 'Contains',
    })
  })

  test('an unknown or absent relation still says something true', () => {
    expect(relationLabel('WHAT_IS_THIS')).toBe('Related')
    expect(relationLabel(undefined)).toBe('Related')
    expect(relationLabel(null)).toBe('Related')
    expect(relationLabel('')).toBe('Related')
  })
})

describe('relationRank', () => {
  test('what the story IS comes before what is beside it', () => {
    expect(relationRank('SOURCE')).toBeLessThan(relationRank('SIDE_STORY'))
    expect(relationRank('PREQUEL')).toBeLessThan(relationRank('ADAPTATION'))
    expect(relationRank('SEQUEL')).toBeLessThan(relationRank('CHARACTER'))
  })

  test('and an unknown relation sorts LAST, not first', () => {
    // `indexOf` answers -1 for a miss, which would put every unknown value at the top of the list
    const known = schemaRelations().map(relationRank)
    expect(relationRank('WHAT_IS_THIS')).toBeGreaterThanOrEqual(Math.max(...known))
    expect(relationRank('WHAT_IS_THIS')).toBeGreaterThan(0)
  })

  test('every relation the schema declares has a place in the order', () => {
    const last = relationRank('WHAT_IS_THIS')
    const unplaced = schemaRelations().filter(relation => relation !== 'OTHER' && relationRank(relation) >= last)
    expect(unplaced, 'add these to ORDER in src/utils/relation-labels.ts').toEqual([])
  })
})

describe('workFormatLabel', () => {
  test('a light novel is named as one, since that is what the reader is being told', () => {
    expect(workFormatLabel('NOVEL')).toBe('Light Novel')
  })

  test('the anime formats keep the casing people write them in', () => {
    expect(workFormatLabel('TV')).toBe('TV')
    expect(workFormatLabel('OVA')).toBe('OVA')
    expect(workFormatLabel('ONA')).toBe('ONA')
    expect(workFormatLabel('MOVIE')).toBe('Movie')
    expect(workFormatLabel('TV_SHORT')).toBe('TV Short')
  })

  test('each format it knows, word for word', () => {
    expect(['SPECIAL', 'MUSIC', 'MANGA', 'ONE_SHOT'].map(workFormatLabel)).toEqual(['Special', 'Music', 'Manga', 'One Shot'])
  })

  test('an unseen format is title cased rather than dropped', () => {
    expect(workFormatLabel('WEB_NOVEL')).toBe('Web Novel')
    expect(workFormatLabel('DOUJINSHI')).toBe('Doujinshi')
  })

  test('and nothing at all where the source named nothing', () => {
    expect(workFormatLabel(undefined)).toBeUndefined()
    expect(workFormatLabel(null)).toBeUndefined()
    expect(workFormatLabel('')).toBeUndefined()
  })
})
