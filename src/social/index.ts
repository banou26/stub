import type { PublishingHub } from './publishing'

import { connect, install } from '@fkn/lib/packages'

import { createPoster } from './activity'
import { createPublishing } from './publishing'

/** FKN Social's site, where the viewer answers stub's ask and picks a name. */
export const SOCIAL_SITE = 'https://social.fkn.app/'

const SOCIAL_PACKAGE = 'https:social.fkn.app'
const SOCIAL_PROTOCOL = 'social@1'

/**
 * FKN Social's posting calls over fkn.app's broker, one connection a page. Only `allowPublishing` installs the
 * package, with fkn.app's notice rather than a prompt; the other calls read a package never installed as off.
 */
export const social = createPublishing({
  connect: async () => {
    try {
      const { remote } = await connect<PublishingHub>(SOCIAL_PACKAGE, { protocol: SOCIAL_PROTOCOL })
      return remote as unknown as PublishingHub
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'not-installed') return null
      throw error
    }
  },
  install: async () => await install(SOCIAL_PACKAGE, { noConfirm: true }) !== null,
})

/** Posts a save of the tracking row to the viewer's FKN Social page, linking to its page on this site. */
export const postActivity = createPoster(social, () => location.origin)
