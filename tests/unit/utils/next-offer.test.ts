import type { MediaChapter } from '@banou/media-player'

import { describe, expect, test } from 'vite-plus/test'

import { skipEventsToChapters } from '../../../src/sources/crunchyroll/skip-events'
import { chaptersBesideNext, nextOfferAt } from '../../../src/utils/next-offer'
import { CREDITS_KEY_ONLY, EVERY_EVENT, OPENING_ONLY } from '../sources/crunchyroll/skip-events-fixture'

// an episode of `duration` s marked `title` from `start` to `end`, in the shape skip-events.ts hands chapters over
const marked = (start: number, end: number, duration: number, title = 'Ending'): MediaChapter[] => [
  { start: 0, end: start, title: 'Episode' },
  { start, end, title },
  ...end < duration ? [{ start: end, end: duration, title: 'Episode' }] : [],
]

// aniskip's endings of 52 episodes, a middle one and the last one of 26 shows (2026-10-26): MAL id,
// episode, the ending's start and end and the length it was marked on, then when Next is offered
const SAMPLE: [number, number, number, number, number, number | undefined][] = [
  [52991, 3, 1367, 1459, 1471, 1458],
  [52991, 28, 1372, 1438, 1464, 1437],
  [57334, 3, 1300, 1390, 1440, 1389],
  [57334, 12, 1319, 1455, 1455, 1318],
  [52299, 3, 1324, 1415, 1420, 1323],
  [52299, 12, 1300, 1391, 1420, 1390],
  [54492, 7, 1268, 1355, 1370, 1354],
  [40748, 3, 1275, 1365, 1435, 1364],
  [40748, 24, 1334, 1424, 1430, 1333],
  [51009, 3, 1330, 1435, 1435, 1329],
  [5114, 7, 1345, 1434, 1434, 1344],
  [50265, 3, 1350, 1440, 1450, 1439],
  [50265, 12, 1361, 1450, 1450, 1360],
  [44511, 3, 1344, 1434, 1435, 1343],
  [44511, 12, 1140, 1226, 1437, undefined],
  [47917, 3, 1325, 1415, 1421, 1324],
  [47917, 12, 1252, 1402, 1420, 1401],
  [52034, 3, 1427, 1516, 1516, 1426],
  [52034, 11, 1270, 1391, 1391, 1269],
  [38000, 3, 1291, 1381, 1420, 1380],
  [38000, 26, 1331, 1420, 1420, 1330],
  [49596, 3, 1305, 1395, 1477, 1394],
  [37521, 3, 1376, 1466, 1466, 1375],
  [16498, 3, 1345, 1435, 1450, 1434],
  [16498, 25, 1364, 1448, 1448, 1363],
  [31240, 3, 2686, 2771, 2950, undefined],
  [11061, 7, 1328, 1417, 1417, 1327],
  [30276, 3, 1321, 1411, 1461, 1410],
  [30276, 12, 1264, 1361, 1441, 1360],
  [9253, 3, 1331, 1421, 1437, 1420],
  [20583, 3, 1363, 1453, 1469, 1452],
  [20583, 25, 1348, 1438, 1442, 1347],
  [50172, 3, 1315, 1405, 1420, 1404],
  [42310, 3, 1361, 1451, 1542, 1450],
  [42310, 10, 1516, 1606, 1697, 1605],
  [37450, 3, 1419, 1477, 1511, 1476],
  [23273, 3, 1281, 1371, 1375, 1280],
  [23273, 22, 1280, 1367, 1370, 1279],
  [39535, 3, 1327, 1417, 1421, 1326],
]

describe('when Next episode is offered', () => {
  test('an ending with less than 10 s after it: a second before the ending', () => {
    // Solo Leveling e3, and an ending that runs to the last second
    expect(nextOfferAt(marked(1324, 1415, 1420), 1420)).toBe(1323)
    expect(nextOfferAt(marked(1319, 1455, 1455), 1455)).toBe(1318)
  })

  test('an ending, then a 3 s card: a second before the ending', () => {
    expect(nextOfferAt([...marked(1280, 1367, 1367), { start: 1367, end: 1370, title: 'Card' }], 1370)).toBe(1279)
  })

  test('an ending, then a preview: a second before the preview, which is something after the ending', () => {
    expect(nextOfferAt(skipEventsToChapters(EVERY_EVENT, 1440), 1440)).toBe(1409)
    expect(nextOfferAt(skipEventsToChapters(EVERY_EVENT), 1440), 'the chapters handed over before the duration').toBe(1409)
  })

  test('an ending, then 90 s: a second before what follows', () => {
    // Cyberpunk: Edgerunners e3, and Jujutsu Kaisen e3's 70 s
    expect(nextOfferAt(marked(1361, 1451, 1542), 1542)).toBe(1450)
    expect(nextOfferAt(marked(1275, 1365, 1435), 1435)).toBe(1364)
  })

  test('an ending, then 3 min, is not the end: as if unmarked, so a closing preview else the end', () => {
    // Chainsaw Man e12, whose ending plays mid-episode, and Re:Zero e3
    expect(nextOfferAt(marked(1140, 1226, 1437), 1437)).toBeUndefined()
    expect(nextOfferAt(marked(2686, 2771, 2950), 2950)).toBeUndefined()
    const previewed = [...marked(1140, 1226, 1420), { start: 1420, end: 1437, title: 'Preview' }]
    expect(nextOfferAt(previewed, 1437)).toBe(1419)
  })

  test('the two bounds: under 10 s after is nothing, 10 s is a part, 2 min still is, past it is story', () => {
    expect(nextOfferAt(marked(1300, 1390, 1399.9), 1399.9)).toBe(1299)
    expect(nextOfferAt(marked(1300, 1390, 1400), 1400)).toBe(1389)
    expect(nextOfferAt(marked(1300, 1390, 1510), 1510)).toBe(1389)
    expect(nextOfferAt(marked(1300, 1390, 1510.5), 1510.5)).toBeUndefined()
  })

  test('a mixed ending, the song over the story, is not an ending', () => {
    expect(nextOfferAt(marked(1324, 1415, 1420, 'Mixed Ending'), 1420)).toBeUndefined()
  })

  test('no ending: at the end, as before', () => {
    expect(nextOfferAt([], 1420)).toBeUndefined()
    expect(nextOfferAt(skipEventsToChapters(OPENING_ONLY, 1440), 1440)).toBeUndefined()
    // a preview with story after it does not close the episode
    expect(nextOfferAt(marked(600, 640, 1440, 'Preview'), 1440)).toBeUndefined()
  })

  // a torrent's file names its own chapters, and an ending is what the player's own Skip Ending calls one
  test('a file\'s ED or Credits is an ending, and its Opening is not', () => {
    for (const title of ['ED', 'Credits', 'ED2', 'エンディング']) {
      expect(nextOfferAt(marked(1300, 1390, 1395, title), 1395), title).toBe(1299)
    }
    expect(nextOfferAt(marked(1300, 1390, 1395, 'Opening'), 1395)).toBeUndefined()
    expect(chaptersBesideNext(marked(1300, 1390, 1395, 'ED'), 1395).map(({ title }) => title)).toEqual(['Episode', 'Episode'])
  })

  test('the last of two endings decides', () => {
    const twice = [...marked(600, 690, 690), ...marked(1324, 1415, 1420).slice(1)]
    expect(nextOfferAt(twice, 1420)).toBe(1323)
  })

  test('Crunchyroll\'s credits running past the video leave nothing after them', () => {
    expect(nextOfferAt(skipEventsToChapters(CREDITS_KEY_ONLY), 1420)).toBe(1324)
    expect(nextOfferAt(skipEventsToChapters({ credits: { start: 1325, end: 1430 } }), 1420)).toBe(1324)
  })

  test('an unknown length offers nothing early', () => {
    for (const duration of [undefined, 0, Number.NaN, Infinity]) {
      expect(nextOfferAt(skipEventsToChapters(CREDITS_KEY_ONLY), duration), String(duration)).toBeUndefined()
    }
  })

  test.each(SAMPLE)('mal %i e%i, an ending from %i to %i of %i s: offered at %s', (_, __, start, end, duration, at) => {
    expect(nextOfferAt(marked(start, end, duration), duration)).toBe(at)
  })

  test('the sample\'s 39 endings: 18 offered before the ending, 19 before what follows, 2 at the end', () => {
    const offers = SAMPLE.map(([, , start, end, duration]) => nextOfferAt(marked(start, end, duration), duration))
    expect([
      offers.filter((at, index) => at === SAMPLE[index]![2] - 1).length,
      offers.filter((at, index) => at === SAMPLE[index]![3] - 1).length,
      offers.filter(at => at === undefined).length,
    ]).toEqual([18, 19, 2])
  })
})

describe('the chapters stub hands its own player beside Next', () => {
  test('leave out the ending when nothing follows it', () => {
    expect(chaptersBesideNext(marked(1324, 1415, 1420), 1420)).toEqual([
      { start: 0, end: 1324, title: 'Episode' },
      { start: 1415, end: 1420, title: 'Episode' },
    ])
  })

  test('keep it when something follows, when it is not the end, and while the length is unknown', () => {
    for (const [chapters, duration] of [
      [skipEventsToChapters(EVERY_EVENT, 1440), 1440],
      [marked(1361, 1451, 1542), 1542],
      [marked(1140, 1226, 1437), 1437],
      [skipEventsToChapters(CREDITS_KEY_ONLY), undefined],
      [marked(1324, 1415, 1420, 'Mixed Ending'), 1420],
    ] as const) {
      expect(chaptersBesideNext([...chapters], duration), String(duration)).toEqual(chapters)
    }
  })
})
