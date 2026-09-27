// @ts-expect-error
import _schema from './schema.gql?raw'
import { trackerOf, trackers } from '../../trackers'
import { trackingResolvers } from '../../../tracking/app-resolvers'
import { stubStorageResolvers } from '../../../sources/stub/storage-resolvers'
import { stubTrackerLink } from '../../../sources/stub/tracker'

export const schema = _schema as string

const tracking = trackingResolvers(trackers, trackerOf)
// the stub tracker's own storage, which no other provider has: asked of it directly, not through the fan-out
const stubStorage = stubStorageResolvers(stubTrackerLink)

export const resolvers = {
  ...tracking,
  Mutation: { ...tracking.Mutation, ...stubStorage.Mutation },
  Subscription: { ...tracking.Subscription, ...stubStorage.Subscription },
}
