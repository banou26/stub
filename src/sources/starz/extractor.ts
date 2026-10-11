import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

export const icon = 'https://www.starz.com/assets/starz/images/favicon.ico'
export const originUrl = 'https://www.starz.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'Starz'
export const origin = 'starz'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['starz']
export const color = '#052e36'

export const resolvers: Resolvers = {
  Subscription: {
    media: { subscribe: async function* () { yield { media: null } } },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* () { yield { mediaPage: { nodes: [] } } }
    }
  }
}
