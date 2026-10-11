import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

export const icon = 'https://pluto.tv/favicon.ico'
export const originUrl = 'https://pluto.tv'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'Pluto TV'
export const origin = 'pluto'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['pluto']
export const color = '#fcf400'

export const resolvers: Resolvers = {
  Subscription: {
    media: { subscribe: async function* () { yield { media: null } } },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* () { yield { mediaPage: { nodes: [] } } }
    }
  }
}
