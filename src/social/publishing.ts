// Copied unchanged from banou26/social src/lib/publishing.ts at 5f86e92, while @banou/fkn-social is not on npm.

import type { Hello, Post, PublishAnswer, PublishingRefusal, PublishingState } from './protocol'
import { SINCE, negotiate, supports } from './protocol'

/** The package's answers to an app's posting calls, over the connection `packages.connect` makes. */
export type PublishingHub = {
  hello: () => Promise<Hello>
  publishing: () => Promise<PublishingState>
  allowPublishing: (ask: { kinds: string[] }) => Promise<PublishingState>
  publish: (post: Post) => Promise<PublishAnswer>
  stopPublishing: () => Promise<PublishingState>
}

/**
 * How the calls reach the package: `connect` answers null when it is not installed for this app, and
 * `install` whether it is installed now. Throws are read as `unavailable`.
 */
export type Transport = { connect: () => Promise<PublishingHub | null>, install: () => Promise<boolean> }

type Reached = { hub: PublishingHub } | { refused: PublishingRefusal } | 'none'

/**
 * What an app calls to post to the person's FKN Social page. Each call answers and never throws. Only
 * `allowPublishing`, which an app calls from the person's own press, installs the package, so fkn.app's
 * notice shows then and never otherwise; with nothing installed the others answer `off` and
 * `not-allowed`. One connection serves the page.
 */
export const createPublishing = ({ connect, install }: Transport) => {
  let reached: Promise<Reached> | null = null
  // a connection is kept, and nothing installed is asked again, since `allowPublishing` may install it
  const reach = () => {
    const attempt = reached ??= (async (): Promise<Reached> => {
      const hub = await connect()
      if (hub === null) return 'none'
      const negotiated = negotiate(await hub.hello())
      if (!negotiated.usable) return { refused: 'outdated' }
      return supports(negotiated, SINCE.publish) ? { hub } : { refused: 'unsupported' }
    })()
    void attempt.then((answer) => { if (answer === 'none' && reached === attempt) reached = null }, () => { if (reached === attempt) reached = null })
    return attempt
  }

  const call = async <T,>(nothing: T, refused: (reason: PublishingRefusal) => T, run: (hub: PublishingHub) => Promise<T>, installing = false): Promise<T> => {
    try {
      let answer = await reach()
      if (answer === 'none' && installing) {
        if (!await install()) return refused('unavailable')
        answer = await reach()
      }
      if (answer === 'none') return installing ? refused('unavailable') : nothing
      if ('refused' in answer) return refused(answer.refused)
      return await run(answer.hub)
    } catch {
      reached = null
      return refused('unavailable')
    }
  }

  const OFF: PublishingState = { state: 'off' }
  const state = (reason: PublishingRefusal): PublishingState => ({ state: reason })
  return {
    /** where this app stands: allowed with its kinds, asked, off, or why it cannot tell */
    publishing: () => call(OFF, state, (hub) => hub.publishing()),
    /** records the ask, which the person answers on social.fkn.app; installs the package first when it is not */
    allowPublishing: (ask: { kinds: Post['kind'][] }) => call(OFF, state, (hub) => hub.allowPublishing(ask), true),
    publish: (post: Post) => call<PublishAnswer>({ ok: false, reason: 'not-allowed' }, (reason) => ({ ok: false, reason }), (hub) => hub.publish(post)),
    /** ends this app's posts at once; what it posted stays until the person deletes it */
    stopPublishing: () => call(OFF, state, (hub) => hub.stopPublishing()),
  }
}
