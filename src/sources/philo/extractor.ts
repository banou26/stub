import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

export const icon = 'https://www.philo.com/favicon.ico'
export const originUrl = 'https://www.philo.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'Philo'
export const origin = 'philo'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['philo']
export const color = '#ff6e5c'

export const resolvers: Resolvers = {
  Subscription: {
    media: { subscribe: async function* () { yield { media: null } } },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* () { yield { mediaPage: { nodes: [] } } }
    }
  }
}
