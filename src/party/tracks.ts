import type { EmbedTracks, TrackList } from '../embed-tracks'

/** A member's own choice of one kind of track: `'party'` follows the party's, a track id, or null for off. */
export type MyTrack = string | null

/**
 * The track to select on this member's player, or undefined to leave it alone: when nothing is wanted,
 * while a switch runs, when it is already selected, or when this source has no such track.
 */
export const trackToSelect = (party: string | null | undefined, mine: MyTrack, local: TrackList & Pick<EmbedTracks, 'busy'>): string | null | undefined => {
  const want = mine === 'party' ? party : mine
  if (want === undefined || local.busy || want === local.selected) return undefined
  if (want !== null && !local.ids.includes(want)) return undefined
  return want
}

/**
 * This member's choice after the player reported `local`, having last reported `previous`.
 *
 * A change nobody here asked for is the member's own pick, made in the player's menu, and lasts the
 * party; picking the party's track again rejoins it. A newly loaded player's first report is where it
 * starts, not a pick, or every episode would turn into an override.
 */
export const nextMine = (
  mine: MyTrack,
  party: string | null | undefined,
  previous: TrackList | undefined,
  local: TrackList,
  requested: string | null | undefined,
): MyTrack => {
  if (!previous || local.selected === previous.selected || local.selected === requested) return mine
  return local.selected === party ? 'party' : local.selected
}
