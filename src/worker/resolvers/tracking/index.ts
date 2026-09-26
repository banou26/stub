// @ts-expect-error
import _schema from './schema.gql?raw'
import { trackerOf, trackers } from '../../trackers'
import { trackingResolvers } from '../../../tracking/app-resolvers'

export const schema = _schema as string

export const resolvers = trackingResolvers(trackers, trackerOf)
