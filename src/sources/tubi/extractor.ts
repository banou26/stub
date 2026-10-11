import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

export const icon = 'https://corporate.tubitv.com/favicon.ico'
export const originUrl = 'https://tubitv.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'Tubi'
export const origin = 'tubi'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['tubi']
export const color = '#fefe12'

export const resolvers: Resolvers = {
  Subscription: {
    media: { subscribe: async function* () { yield { media: null } } },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* () { yield { mediaPage: { nodes: [] } } }
    }
  }
}
