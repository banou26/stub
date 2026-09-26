import type { Resolvers } from '../../generated/schema/types.generated'

// @ts-expect-error
import baseSchema from '../schema.gql?raw'
import { resolvers as mediaResolvers, schema as mediaSchema } from './media'
import { resolvers as episodeResolvers, schema as episodeSchema } from './episode'
import { resolvers as playbackSourceResolvers, schema as playbackSourceSchema } from './playback-source'
import { resolvers as originResolvers, schema as originSchema } from './origin'
import { resolvers as trackingResolvers, schema as trackingSchema } from './tracking'

export const schema = [baseSchema, episodeSchema, playbackSourceSchema, mediaSchema, originSchema, trackingSchema].join('\n\n')

export const resolvers = {
  ...mediaResolvers,
  ...episodeResolvers,
  ...playbackSourceResolvers,
  ...originResolvers,
  ...trackingResolvers,
  Query: {
    ...mediaResolvers.Query,
    ...episodeResolvers.Query,
    ...playbackSourceResolvers.Query,
    ...originResolvers.Query,
    ...trackingResolvers.Query,
  },
  Mutation: {
    ...mediaResolvers.Mutation,
    ...episodeResolvers.Mutation,
    ...playbackSourceResolvers.Mutation,
    ...originResolvers.Mutation,
    ...trackingResolvers.Mutation,
  },
  Subscription: {
    ...mediaResolvers.Subscription,
    ...episodeResolvers.Subscription,
    ...playbackSourceResolvers.Subscription,
    ...originResolvers.Subscription,
    ...trackingResolvers.Subscription,
  },
} satisfies Resolvers
