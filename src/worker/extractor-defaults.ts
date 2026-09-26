// What every provider server answers where its own resolvers say nothing. Split out of
// worker/extractor.ts so a test can build a server from exactly these: that module reaches urql and
// cannot load under vitest.

import type { Resolvers } from '../generated/schema/types.generated'
import type { Origin } from './store/types'

/**
 * The resolvers `makeExtractor` merges UNDER a provider's own.
 *
 * Every subscription default YIELDS its refusal rather than ending: a subscription generator that
 * completes without yielding makes yoga respond 204 No Content, which the caller would sit on until
 * its timeout instead of reading a refusal off the first payload. The mutations answer an empty list,
 * which the app reads as "this provider takes no writes".
 */
export const defaultResolvers = (originData: Origin) => ({
  Media: {
    _id: (parent) => parent.uri,
    handles: (parent) => parent.handles ?? [],
    relations: (parent) => parent.relations ?? [],
    categories: (parent) => parent.categories ?? [],
    // every non-null list on Media needs one of these, because a source may omit any field
    // and a null in a non-null position nulls its whole parent, taking the rest of the
    // payload with it
    genres: (parent) => parent.genres ?? [],
    tags: (parent) => parent.tags ?? [],
    titles: (parent) => parent.titles ?? [],
    descriptions: (parent) => parent.descriptions ?? [],
    shortDescriptions: (parent) => parent.shortDescriptions ?? [],
    covers: (parent) => parent.covers ?? [],
    banners: (parent) => parent.banners ?? [],
    trailers: (parent) => parent.trailers ?? [],
    episodes: (parent) => parent.episodes ?? [],
  },
  Episode: {
    _id: (parent) => parent.uri,
    handles: (parent) => parent.handles ?? [],
    descriptions: (parent) => parent.descriptions ?? [],
    shortDescriptions: (parent) => parent.shortDescriptions ?? []
  },
  Query: {
  },
  Mutation: {
    saveListEntry: () => [],
    deleteListEntry: () => [],
  },
  Subscription: {
    origin: {
      resolve: () => originData,
      subscribe: async function*() { return yield originData }
    },
    originPage: {
      resolve: () => ({ nodes: [originData] }),
      subscribe: async function* () { yield [originData] }
    },
    media: { subscribe: async function* (_parent) { yield { media: null } } },
    mediaPage: { subscribe: async function* (_parent) { yield { mediaPage: { nodes: [] } } } },
    // most sources cannot answer show-plus-evidence, and the default has to YIELD that rather
    // than end, for the 204 reason above
    similarMedia: { subscribe: async function* (_parent) { yield { similarMedia: null } } },
    // and the same default for the second question, for the same reason: `implementsContainingMedia`
    // keeps the funnel off a source that ships no resolver, and any other caller of the field
    // reads a refusal rather than waiting out a 204
    containingMedia: { subscribe: async function* (_parent) { yield { containingMedia: null } } },
    // a media source is never asked this, and a tracker that is asked and implements nothing says so
    tracking: { subscribe: async function* (_parent) { yield { tracking: null } } }
  }
} satisfies Resolvers)
