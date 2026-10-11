import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

export const icon = 'https://www.hoopladigital.com/images/h-favicon.png'
export const originUrl = 'https://www.hoopladigital.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'Hoopla'
export const origin = 'hoopla'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['hoopla']
export const color = '#2050dd'

export const resolvers: Resolvers = {
  Subscription: {
    media: { subscribe: async function* () { yield { media: null } } },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* () { yield { mediaPage: { nodes: [] } } }
    }
  }
}
