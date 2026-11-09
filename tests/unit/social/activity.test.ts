import type { Post, PublishAnswer, PublishingState } from '../../../src/social/protocol'

import { describe, expect, test, vi } from 'vite-plus/test'

import { createPoster, postOf } from '../../../src/social/activity'
import { activityOf } from '../../../src/tracking/compact'

// STUB-58 (publish what you watch to your FKN Social profile): what a save of the tracking row posts, and when.

const ORIGIN = 'https://anime.fkn.app'
const FRIEREN = 'ag:(mal:52991,anilist:154587)'
const saved = { kind: 'watched' as const, detail: 'Episode 5', title: 'Frieren', uri: FRIEREN, cover: 'https://img.anili.st/frieren.jpg' }
const HOUR = 3_600_000

describe('what a save of the tracking row tells', () => {
  test('its strongest change: Completed, else progress up, else Watching', () => {
    expect(activityOf({ status: 'WATCHING', progress: 4 }, { status: 'WATCHING', progress: 5 })).toEqual({ kind: 'watched', episode: 5 })
    expect(activityOf({ status: 'WATCHING', progress: 11 }, { status: 'COMPLETED', progress: 12 })).toEqual({ kind: 'completed' })
    expect(activityOf({ status: 'PLANNING', progress: 0 }, { status: 'WATCHING', progress: 0 })).toEqual({ kind: 'started' })
    expect(activityOf({ status: null, progress: 0 }, { status: 'WATCHING', progress: 1 }), 'the first episode of a show not listed').toEqual({ kind: 'watched', episode: 1 })
    expect(activityOf({ status: 'WATCHING', progress: 5 }, { status: 'WATCHING', progress: 3 }), 'a count lowered').toBeUndefined()
    expect(activityOf({ status: 'COMPLETED', progress: 12 }, { status: 'COMPLETED', progress: 12 }), 'a score alone').toBeUndefined()
    expect(activityOf({ status: 'WATCHING', progress: 3 }, { status: 'PAUSED', progress: 3 })).toBeUndefined()
  })
})

describe('the post a save makes', () => {
  test("the show's title, its page on this site, its https cover and the id stub keeps it under, AniList's first", () => {
    expect(postOf(saved, ORIGIN)).toStrictEqual({
      kind: 'watched',
      title: 'Frieren',
      link: 'https://anime.fkn.app/title/ag:(anilist:154587)',
      detail: 'Episode 5',
      image: 'https://img.anili.st/frieren.jpg',
      subject: 'anilist:154587',
    })
    expect(postOf({ kind: 'started', title: 'A film', uri: 'ag:(jw:tm1)' }, ORIGIN), 'known by no catalogue: its own id').toStrictEqual({
      kind: 'started', title: 'A film', link: 'https://anime.fkn.app/title/ag:(jw:tm1)', subject: 'jw:tm1',
    })
  })

  test("within FKN Social's caps: 150 code points of title, 40 of detail, an https image of 300 characters at most", () => {
    const capped = postOf({ ...saved, title: `  ${'あ'.repeat(200)}`, detail: 'x'.repeat(60) }, ORIGIN)!
    expect([...capped.title]).toEqual(Array(150).fill('あ'))
    expect(capped.detail).toBe('x'.repeat(40))
    expect(postOf({ ...saved, cover: 'http://img.anili.st/frieren.jpg' }, ORIGIN)!.image).toBeUndefined()
    expect(postOf({ ...saved, cover: `https://img.anili.st/${'a'.repeat(300)}.jpg` }, ORIGIN)!.image).toBeUndefined()
  })

  test('none with no title, no one id for the show, or no https page for it', () => {
    expect(postOf({ ...saved, title: ' ' }, ORIGIN)).toBeUndefined()
    expect(postOf({ ...saved, title: null }, ORIGIN)).toBeUndefined()
    expect(postOf({ ...saved, uri: 'ag:(anilist:1,anilist:2)' }, ORIGIN), 'two shows').toBeUndefined()
    expect(postOf({ ...saved, uri: `ag:(jw:${'a'.repeat(61)})` }, ORIGIN)?.subject, 'an id of 64 characters').toBe(`jw:${'a'.repeat(61)}`)
    expect(postOf({ ...saved, uri: `ag:(jw:${'a'.repeat(62)})` }, ORIGIN), 'an id of 65 characters').toBeUndefined()
    expect(postOf({ ...saved, uri: 'ag:(jw:été)' }, ORIGIN), 'an id beyond printable ASCII').toBeUndefined()
    expect(postOf(saved, 'http://localhost:4173')).toBeUndefined()
  })
})

describe('the poster', () => {
  const fake = (state: PublishingState, answer: PublishAnswer = { ok: true, id: 'entry' }) => {
    const posted: Post[] = []
    return { posted, publishing: vi.fn(async () => state), publish: vi.fn(async (post: Post) => { posted.push(post); return answer }) }
  }

  test('posts only while the viewer allowed it, and only the kinds allowed', async () => {
    for (const state of [{ state: 'off' }, { state: 'asked' }, { state: 'no-name' }, { state: 'unavailable' }, { state: 'allowed', kinds: ['started'] }] as PublishingState[]) {
      const calls = fake(state)
      await createPoster(calls, () => ORIGIN)(saved)
      expect(calls.publishing, state.state).toHaveBeenCalledOnce()
      expect(calls.posted, state.state).toEqual([])
    }
    const calls = fake({ state: 'allowed', kinds: ['started', 'watched', 'completed'] })
    await createPoster(calls, () => ORIGIN)(saved)
    expect(calls.posted).toEqual([postOf(saved, ORIGIN)])
  })

  test('at most 10 an hour from the page, and a refused post is dropped, never sent again', async () => {
    let now = 1_000_000
    const calls = fake({ state: 'allowed', kinds: ['watched'] }, { ok: false, reason: 'too-many' })
    const post = createPoster(calls, () => ORIGIN, () => now)
    for (let episode = 1; episode <= 12; episode++) await post({ ...saved, detail: `Episode ${episode}` })
    expect(calls.posted.map(({ detail }) => detail)).toEqual(Array.from({ length: 10 }, (_, at) => `Episode ${at + 1}`))
    now += HOUR - 1
    await post({ ...saved, detail: 'Episode 13' })
    expect(calls.posted).toHaveLength(10)
    now += 1
    await post({ ...saved, detail: 'Episode 14' })
    expect(calls.posted.at(-1)?.detail).toBe('Episode 14')
  })

  test('never throws, whatever fails', async () => {
    const calls = { publishing: vi.fn(async (): Promise<PublishingState> => { throw new Error('gone') }), publish: vi.fn() }
    await expect(createPoster(calls, () => ORIGIN)(saved)).resolves.toBeUndefined()
    await expect(createPoster(calls, () => { throw new ReferenceError('location is not defined') })(saved)).resolves.toBeUndefined()
    expect(calls.publish).not.toHaveBeenCalled()
  })
})
