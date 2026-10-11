import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

export const icon = 'https://static.diceplatform.com/prod/original/dce.hidive/settings/HIDIVE_Logo_iOS_1024x1024_281_29.Y3YMf.vMQ59.png'
export const originUrl = 'https://www.hidive.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'HIDIVE'
export const origin = 'hidive'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['hidive']
export const color = '#10b1f0'

export const resolvers: Resolvers = {
  Subscription: {
    media: { subscribe: async function* () { yield { media: null } } },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* () { yield { mediaPage: { nodes: [] } } }
    }
  }
}
