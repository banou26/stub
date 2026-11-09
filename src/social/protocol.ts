// The posting calls' part of banou26/social src/lib/protocol.ts at 5f86e92, copied word for word, while
// @banou/fkn-social is not on npm. The site's own calls are left out, and SINCE keeps the posting calls alone.

/**
 * The RPC level this build of the library speaks.
 *
 * The library and the package ship on DIFFERENT trains: the library is pinned in each consumer's
 * manifest and moves on an npm publish, the package is redeployed on every push to Pages. So the two
 * are routinely different ages in the same browser, and neither can assume the other's level.
 *
 * Bump this when a new call is added. Never bump it to retire one: that is what `min` is for.
 */
export const PROTOCOL = 2

/** What the package answers before anything else, so the library knows what it may call. */
export type Hello = {
  /** the level the package speaks */
  protocol: number
  /** the oldest library level it still serves */
  min: number
}

/**
 * What an app posts to the person's page: the kind of thing that happened, the title of what it
 * happened to, a short line after it ("Episode 5"), where the thing is (https, and on the app's own
 * origin when the app is one), its artwork, and the app's own stable id for it, so entries about one
 * thing draw together. The package normalises the text to NFC, checks every field, and stamps the
 * entry with an id, the app and the time.
 */
export type Post = { kind: 'started' | 'watched' | 'completed' | 'rated', title: string, detail?: string, link: string, image?: string, subject?: string }

/**
 * Why a posting call did nothing. `not-here`: the connection is not one fkn.app's broker made, so it
 * names no app. `no-name`: no FKN Social name yet. `locked`: the account's key is locked here, so
 * nothing was read and no card raised. `unavailable`: anything else that stopped it. `outdated` and
 * `unsupported`: this library is older than the package serves, or the package older than this library.
 */
export type PublishingRefusal = 'not-here' | 'no-name' | 'locked' | 'unavailable' | 'outdated' | 'unsupported'

/**
 * Where an app stands with the person. `allowed`: its posts land, of these kinds. `asked`: it asked and
 * the person has not answered on social.fkn.app. `off`: it never asked, or the person said Not now or
 * Stop, so it may ask again.
 */
export type PublishingState = { state: 'allowed', kinds: string[] } | { state: 'asked' } | { state: 'off' } | { state: PublishingRefusal }

/**
 * What `publish` answers. `not-allowed`: not Allowed, the kind not allowed, or the person's Activity is
 * Off. `invalid`: a field the package refuses. `too-many`: 10 entries from this app in the last hour.
 * A refused post is dropped.
 */
export type PublishAnswer = { ok: true, id: string } | { ok: false, reason: 'not-allowed' | 'invalid' | 'too-many' | PublishingRefusal }

export type Negotiation =
  | { usable: true, level: number }
  /** this library is older than the package still serves; every surface degrades rather than throws */
  | { usable: false, reason: 'outdated' }

/**
 * Decides what this library may call against the package that answered.
 *
 * The normal direction is the package being NEWER, and that must always work: the package only adds,
 * and never removes a call at a level it still serves. The reverse happens too, when a consumer
 * updates the library before the site has redeployed, and there the library must confine itself to
 * the calls the package's own level defines.
 */
export const negotiate = (hello: Hello): Negotiation => {
  if (PROTOCOL < hello.min) return { usable: false, reason: 'outdated' }
  return { usable: true, level: Math.min(PROTOCOL, hello.protocol) }
}

/** Whether a call introduced at `since` may be made at the negotiated level. */
export const supports = (negotiation: Negotiation, since: number): boolean =>
  negotiation.usable && negotiation.level >= since

/** The level each call was introduced at. */
export const SINCE = {
  publishing: 2,
  allowPublishing: 2,
  publish: 2,
  stopPublishing: 2,
} as const satisfies Record<string, number>
