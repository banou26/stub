import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

export const icon = 'https://therokuchannel.roku.com/favicon.ico'
export const originUrl = 'https://therokuchannel.roku.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'The Roku Channel'
export const origin = 'roku'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['roku']
export const color = '#662d91'

export const resolvers: Resolvers = {
  Subscription: {
    media: { subscribe: async function* () { yield { media: null } } },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* () { yield { mediaPage: { nodes: [] } } }
    }
  }
}
