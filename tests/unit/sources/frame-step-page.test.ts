import { describe, expect, test } from 'vite-plus/test'

import { stepVideoFrame, watchVideoFrames } from '../../../src/sources/frame-step-page'
import { pageRealm } from './crunchyroll/page-realm'
import { evenly, pageVideo } from './page-video'

// The frame steps stub makes inside a service's own page, run as `frame.evaluate` runs them.

const FILM = 1001 / 24000
const PAL = 0.04

const page = (body = '<video></video>') => pageRealm(`<!doctype html><html><body>${body}</body></html>`)

const video = (realm: ReturnType<typeof page>, element = realm.document.querySelector('video')!, options?: { currentTime?: number, lands?: boolean }) =>
  pageVideo(element, options)

const VIDEO = { video: 'video' }

/** The frame length a step uses: paused, seeked to 100 s and stepped forward once. */
const lengthInUse = async (realm: ReturnType<typeof page>, media: ReturnType<typeof video>) => {
  media.element.pause()
  media.element.currentTime = 100
  await new Promise(resolve => setTimeout(resolve, 20))
  await realm.evaluate(stepVideoFrame, { ...VIDEO, direction: 1 })
  return media.writes.at(-1)! - 100
}

describe('stepVideoFrame', () => {
  test('steps a paused video one film frame from its position, forward and back', async () => {
    const realm = page()
    const media = video(realm, undefined, { currentTime: 600 })
    await realm.evaluate(stepVideoFrame, { ...VIDEO, direction: 1 })
    await realm.evaluate(stepVideoFrame, { ...VIDEO, direction: -1 })
    expect(media.writes[0]).toBeCloseTo(600 + FILM, 9)
    expect(media.writes[1]).toBeCloseTo(600, 9)
  })

  test('pauses a playing video, then steps to the frame after the last one it presented', async () => {
    const realm = page()
    const media = video(realm)
    await realm.evaluate(watchVideoFrames, VIDEO)
    media.play(evenly(10, PAL, 30))
    await realm.evaluate(stepVideoFrame, { ...VIDEO, direction: 1 })
    expect(media.element.paused).toBe(true)
    // the middle of the next frame: 11.16 is the last one presented
    expect(media.writes).toHaveLength(1)
    expect(media.writes[0]).toBeCloseTo(10 + 29 * PAL + 1.5 * PAL, 9)
  })

  test('steps back from a pause into the frame before the last one presented', async () => {
    const realm = page()
    const media = video(realm)
    await realm.evaluate(watchVideoFrames, VIDEO)
    media.play(evenly(10, PAL, 30))
    await realm.evaluate(stepVideoFrame, { ...VIDEO, direction: -1 })
    expect(media.writes[0]).toBeCloseTo(10 + 29 * PAL - 0.5 * PAL, 9)
  })

  test('steps from the frame presented just after the pause', async () => {
    const realm = page()
    const media = video(realm)
    await realm.evaluate(watchVideoFrames, VIDEO)
    media.play(evenly(10, PAL, 30))
    // Chrome can still present a frame once paused
    media.state.afterPause = () => { setTimeout(() => media.present(10 + 30 * PAL), 20) }
    await realm.evaluate(stepVideoFrame, { ...VIDEO, direction: 1 })
    expect(media.writes[0]).toBeCloseTo(10 + 30 * PAL + 1.5 * PAL, 9)
  })

  test('after a seek, steps from where it landed by the frame length learned while playing', async () => {
    const realm = page()
    const media = video(realm)
    await realm.evaluate(watchVideoFrames, VIDEO)
    media.play(evenly(10, PAL, 30))
    expect(await lengthInUse(realm, media)).toBeCloseTo(PAL, 9)
  })

  // Matroska's millisecond timestamps give gaps of 41 and 42 ms for a 41.708 ms frame, and a stall leaves a long one
  test('learns the frame length as the mean of the gaps near their median', async () => {
    const realm = page()
    const media = video(realm)
    await realm.evaluate(watchVideoFrames, VIDEO)
    const gaps = [0.041, 0.042, 0.042, 0.041, 0.042, 0.042, 0.041, 0.042, 0.042, 0.042, 0.2]
    media.play(gaps.reduce((times, gap) => [...times, times.at(-1)! + gap], [10]))
    expect(await lengthInUse(realm, media)).toBeCloseTo((3 * 0.041 + 7 * 0.042) / 10, 9)
  })

  test('learns no frame length from frames played faster than 1x, skipped between, or going back', async () => {
    // what a 60 Hz display presents of a 50 fps file at 2x, a frame dropped between each, and a loop
    const plays = [
      ['at 2x', evenly(10, 2 * PAL, 30), { rate: 2 }],
      ['skipping', evenly(10, 2 * PAL, 30), { skipped: 1 }],
      ['going back', evenly(20, -PAL, 30), {}],
    ] as const
    for (const [label, times, options] of plays) {
      const realm = page()
      const media = video(realm)
      await realm.evaluate(watchVideoFrames, VIDEO)
      media.play([...times], options)
      expect(await lengthInUse(realm, media), label).toBeCloseTo(FILM, 9)
    }
  })

  test('learns the frame length from the last 60 gaps', async () => {
    const realm = page()
    const media = video(realm)
    await realm.evaluate(watchVideoFrames, VIDEO)
    media.play(evenly(10, 0.05, 70))
    media.play(evenly(20, PAL, 70))
    expect(await lengthInUse(realm, media)).toBeCloseTo(PAL, 9)
  })

  test('steps from where a seek still waiting for its data is going, not from the frame played before it', async () => {
    const realm = page()
    const media = video(realm, undefined, { lands: false })
    await realm.evaluate(watchVideoFrames, VIDEO)
    media.play(evenly(10, PAL, 30))
    media.element.currentTime = 50
    await realm.evaluate(stepVideoFrame, { ...VIDEO, direction: 1 })
    expect(media.writes.at(-1)).toBeCloseTo(50 + PAL, 9)
  })

  test('learns again from frames played after a seek', async () => {
    const realm = page()
    const media = video(realm)
    await realm.evaluate(watchVideoFrames, VIDEO)
    media.element.currentTime = 50
    await new Promise(resolve => setTimeout(resolve, 20))
    media.play(evenly(50, PAL, 30))
    await realm.evaluate(stepVideoFrame, { ...VIDEO, direction: 1 })
    expect(media.writes[1]).toBeCloseTo(50 + 29 * PAL + 1.5 * PAL, 9)
  })

  test('forgets the frame length when a new media loads on the element', async () => {
    const realm = page()
    const media = video(realm)
    await realm.evaluate(watchVideoFrames, VIDEO)
    media.play(evenly(10, PAL, 30))
    media.fire('emptied')
    expect(await lengthInUse(realm, media)).toBeCloseTo(FILM, 9)
  })

  test('steps the element the index names among those the selector matches', async () => {
    const realm = page('<div id="player"><video></video><video></video></div>')
    const [first, second] = [...realm.document.querySelectorAll('video')]
    const ad = video(realm, first, { currentTime: 5 })
    const episode = video(realm, second, { currentTime: 600 })
    await realm.evaluate(stepVideoFrame, { video: '#player video', index: 1, direction: 1 })
    expect(ad.writes).toEqual([])
    expect(episode.writes[0]).toBeCloseTo(600 + FILM, 9)
  })

  test('steps the element it watches when the page adds a video ahead of it', async () => {
    const realm = page('<div id="player"><video></video></div>')
    const episode = video(realm, undefined, { currentTime: 600 })
    await realm.evaluate(watchVideoFrames, { video: '#player video' })
    const added = realm.document.createElement('video')
    realm.document.querySelector('#player')!.prepend(added)
    const ad = video(realm, added, { currentTime: 5 })
    await realm.evaluate(stepVideoFrame, { video: '#player video', direction: 1 })
    expect(ad.writes).toEqual([])
    expect(episode.writes[0]).toBeCloseTo(600 + FILM, 9)
  })

  test('stays inside the media', async () => {
    const realm = page()
    const media = video(realm, undefined, { currentTime: 0.01 })
    await realm.evaluate(stepVideoFrame, { ...VIDEO, direction: -1 })
    expect(media.writes).toEqual([0])
  })

  test('answers after three seconds when the seek never lands', async () => {
    const realm = page()
    video(realm, undefined, { currentTime: 600, lands: false })
    const started = Date.now()
    await realm.evaluate(stepVideoFrame, { ...VIDEO, direction: 1 })
    expect(Date.now() - started).toBeGreaterThanOrEqual(2950)
    expect(Date.now() - started).toBeLessThan(4000)
  })

  test('answers at once when the page has no such video', async () => {
    const realm = page('')
    await expect(realm.evaluate(stepVideoFrame, { ...VIDEO, direction: 1 })).resolves.toBeUndefined()
  })
})

describe('watchVideoFrames', () => {
  test('watches an element once, however often it is asked', async () => {
    const realm = page()
    const media = video(realm)
    await realm.evaluate(watchVideoFrames, VIDEO)
    await realm.evaluate(watchVideoFrames, VIDEO)
    expect(media.callbacks).toHaveLength(1)
  })

  test('watches the element the index names among those the selector matches', async () => {
    const realm = page('<div id="player"><video></video><video></video></div>')
    const [first, second] = [...realm.document.querySelectorAll('video')]
    const ad = video(realm, first)
    const episode = video(realm, second)
    await realm.evaluate(watchVideoFrames, { video: '#player video', index: 1 })
    expect(ad.callbacks).toEqual([])
    expect(episode.callbacks).toHaveLength(1)
  })
})
