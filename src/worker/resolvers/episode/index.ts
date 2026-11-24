import type { Resolvers } from '../../../generated/schema/types.generated'
// @ts-expect-error
import _schema from './schema.gql?raw'
import { translationFirst } from '../../../sources/translations'
import { heldViewerLanguages } from '../../../viewer-languages'
import { descriptionAs } from '../utils'

export const schema = _schema as string

export const resolvers = {
  Query: {},
  Mutation: {},
  Subscription: {},
  Episode: {
    handles: (parent) => parent.handles ?? [],
    titles: (parent) => translationFirst(parent.titles ?? [], heldViewerLanguages().language),
    descriptions: (parent, args) =>
      parent.descriptions?.slice(0, args.input?.count || undefined)
        .map(item => ({ ...item, description: descriptionAs(item.description, args.input?.type) })),
    shortDescriptions: (parent, args) =>
      parent.shortDescriptions?.slice(0, args.input?.count || undefined)
        .map(item => ({ ...item, shortDescription: descriptionAs(item.shortDescription, args.input?.type) })),
  }
} satisfies Resolvers
