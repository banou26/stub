import type { Resolvers } from '../../../generated/schema/types.generated'
// @ts-expect-error
import _schema from './schema.gql?raw'
import { descriptionAs } from '../utils'

export const schema = _schema as string

export const resolvers = {
  Query: {},
  Mutation: {},
  Subscription: {},
  Episode: {
    handles: (parent) => parent.handles ?? [],
    descriptions: (parent, args) =>
      parent.descriptions?.slice(0, args.input?.count || undefined)
        .map(item => ({ ...item, description: descriptionAs(item.description, args.input?.type) })),
    shortDescriptions: (parent, args) =>
      parent.shortDescriptions?.slice(0, args.input?.count || undefined)
        .map(item => ({ ...item, shortDescription: descriptionAs(item.shortDescription, args.input?.type) })),
  }
} satisfies Resolvers
