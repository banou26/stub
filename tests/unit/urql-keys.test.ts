// `satisfies KeyingConfig` does not force exhaustiveness, so a new embedded type compiles, type-checks
// and ships, and says so only as a dev-console warning while graphcache invents a key for an object
// that has none. `MediaAiringEpisode` did exactly that the day it was added.
import { describe, expect, test } from 'vitest'

import introspection from '../../src/generated/graphql.schema.json'
import { keyResolvers } from '../../src/urql-keys'
import { aggregateTracking } from '../../src/tracking/aggregate'

type IntrospectionType = {
  kind: string
  name?: string | null
  ofType?: IntrospectionType | null
  fields?: { name: string, type: IntrospectionType }[] | null
}

const schema = (introspection as { __schema?: unknown }).__schema as {
  types: IntrospectionType[]
  queryType?: { name: string } | null
  mutationType?: { name: string } | null
  subscriptionType?: { name: string } | null
} ?? introspection as never

const named = (type: IntrospectionType): string | undefined =>
  type.name ?? (type.ofType ? named(type.ofType) : undefined)

const roots = new Set([schema.queryType?.name, schema.mutationType?.name, schema.subscriptionType?.name])
const objects = schema.types.filter(type => type.kind === 'OBJECT' && !type.name?.startsWith('__'))

// A type reached only as a root field's result is embedded on the operation root and needs no key of
// its own, which is why the page wrappers are not in the config and must not be demanded.
const nested = new Set(
  objects
    .filter(type => !roots.has(type.name ?? ''))
    .flatMap(type => (type.fields ?? []).map(field => named(field.type)))
    .filter((name): name is string => Boolean(name))
)

describe('keyResolvers', () => {
  test('every embedded type in the schema has an entry', () => {
    const missing = objects
      .filter(type => !roots.has(type.name ?? ''))
      .filter(type => nested.has(type.name ?? ''))
      .filter(type => !(type.fields ?? []).some(field => field.name === 'id' || field.name === '_id'))
      .map(type => type.name)
      .filter(name => !(name! in keyResolvers))

    expect(missing, 'add `<Type>: () => null` to keyResolvers in src/urql-keys.ts').toEqual([])
  })

  test('and the control: the rig can see a type that has one', () => {
    expect(Object.keys(keyResolvers)).toContain('MediaCover')
    expect(objects.map(type => type.name)).toContain('MediaAiringEpisode')
  })
})

// The tracking summary is display only, and a cache that keyed it like a tracker's own entry would
// write the summary's numbers onto that tracker's row.
test('the tracking summary and a tracker\'s entry never share a cache key', () => {
  const entry = { _id: 'stub:e1', tracker: 'stub', progress: 3 }
  const answer = {
    _id: 'answer:stub:ag:(anilist:1)',
    tracker: { id: 'stub', name: 'Stub', signedIn: true, canWrite: true, scoreScale: 'POINT_100' },
    state: 'LISTED' as const,
    entry,
    candidates: [],
    pending: 0,
  }
  const { summary } = aggregateTracking('ag:(anilist:1)', [answer])

  expect(keyResolvers.ListEntry(entry as never)).toBe('stub:e1')
  expect(keyResolvers.ListEntry(summary as never)).not.toBe(keyResolvers.ListEntry(entry as never))
})
