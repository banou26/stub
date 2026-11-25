import { social, SOCIAL_PACKAGE, SOCIAL_PROTOCOL } from '@banou/social'

import { activityOrigin, createPoster } from './activity'

export type {
  Availability,
  Participant,
  Post,
  Presence,
  PublishAnswer,
  PublishingRefusal,
  PublishingState,
  RoomBinding,
} from '@banou/social'

export { social, SOCIAL_PACKAGE, SOCIAL_PROTOCOL }

/** FKN Social's site, where the viewer answers stub's ask and picks a name. */
export const SOCIAL_SITE = 'https://social.fkn.app/'

/** Posts a save of the tracking row to the viewer's FKN Social page, linking to its canonical site page. */
export const postActivity = createPoster(social, () => activityOrigin())
