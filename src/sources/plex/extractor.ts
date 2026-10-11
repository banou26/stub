import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

export const icon = 'https://watch.plex.tv/icons/favicon.ico'
export const originUrl = 'https://watch.plex.tv'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'Plex'
export const origin = 'plex'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['plex']
export const color = '#ecaf00'

export const resolvers: Resolvers = {
  Subscription: {
    media: { subscribe: async function* () { yield { media: null } } },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* () { yield { mediaPage: { nodes: [] } } }
    }
  }
}
