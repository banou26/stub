import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

export const icon = 'https://www.amcplus.com/favicon.ico'
export const originUrl = 'https://www.amcplus.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'AMC+'
export const origin = 'amcplus'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['amcplus']
export const color = '#8fd3d3'

export const resolvers: Resolvers = {
  Subscription: {
    media: { subscribe: async function* () { yield { media: null } } },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* () { yield { mediaPage: { nodes: [] } } }
    }
  }
}
