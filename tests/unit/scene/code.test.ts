// The picture's color code is the whole of what a scene search sends, so it has to be the code of the scene and not
// of the phone around it. Measured 2026-10-24 on trace.moe: a frame centred in a black phone screenshot, coded whole,
// matched the wrong show at 0.9532 with all six top results wrong above 0.9; trimmed first, it matched at 0.9999.
import { describe, expect, test } from 'vite-plus/test'
import { ColorLayout, encodeColorLayout } from 'trace.moe-id'

import { sceneCode, trimBars } from '../../../src/scene/code'
import { isSceneCode } from '../../../src/scene/search'
import { frame, letterboxed, withPhoneChrome } from '../../fixtures/scene/frame'

// what tests/fixtures/scene/frame.ts codes to, computed 2026-10-25; tests/scene-search.spec.ts sends it from a browser
const FRAME_CODE = 'eOOEIPhB0IQhB8IQg-TPYQg-D0IQ'

describe('trimBars', () => {
  test('finds exactly the frame inside a portrait phone screenshot', () => {
    expect(trimBars(letterboxed(frame(), 640, 1386))).toEqual({ x: 0, y: 513, width: 640, height: 360 })
  })

  test('finds it inside a phone screenshot whose bars carry the clock, the battery and the home indicator', () => {
    expect(trimBars(withPhoneChrome(letterboxed(frame(), 640, 1386)))).toEqual({ x: 0, y: 513, width: 640, height: 360 })
  })

  test('takes only fully black bars off a landscape picture, whose dark edges with a light in them are the picture', () => {
    const lit = letterboxed(frame(), 640, 480)
    for (let y = 440; y < 450; y++) lit.data.fill(255, (y * 640 + 270) * 4, (y * 640 + 370) * 4)
    expect(trimBars(lit)).toEqual({ x: 0, y: 60, width: 640, height: 390 })
  })

  test('finds it inside bars on all four sides', () => {
    expect(trimBars(letterboxed(frame(), 800, 450))).toEqual({ x: 80, y: 45, width: 640, height: 360 })
  })

  test('keeps a picture with no bars whole, and one dark all over', () => {
    expect(trimBars(frame())).toEqual({ x: 0, y: 0, width: 640, height: 360 })
    const dark = letterboxed({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, 64, 36)
    expect(trimBars(dark)).toEqual({ x: 0, y: 0, width: 64, height: 36 })
    const lines = letterboxed(frame(40, 1), 40, 81)
    lines.data.fill(255, 0, 40 * 4)
    expect(trimBars(lines), 'a portrait picture with no column lit over the share keeps its black bar trim').toEqual({ x: 0, y: 0, width: 40, height: 41 })
  })
})

describe('sceneCode', () => {
  test('is the 28-character code trace.moe searches by, and the same for every run', () => {
    expect(sceneCode(frame())).toBe(FRAME_CODE)
    expect(isSceneCode(FRAME_CODE)).toBe(true)
  })

  test('codes a letterboxed screenshot as its frame, which coded whole is another picture', () => {
    const boxed = letterboxed(frame(), 640, 1386)
    expect(encodeColorLayout(ColorLayout.extract({ ...boxed, channels: 4 })), 'the control: the bars change the code').not.toBe(FRAME_CODE)
    expect(sceneCode(boxed)).toBe(FRAME_CODE)
    expect(sceneCode(letterboxed(frame(), 800, 450))).toBe(FRAME_CODE)
    expect(sceneCode(withPhoneChrome(letterboxed(frame(), 640, 1386)))).toBe(FRAME_CODE)
  })
})
