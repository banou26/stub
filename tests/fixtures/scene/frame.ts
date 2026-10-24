import type { Pixels } from '../../../src/scene/code'

/**
 * A 640x360 picture standing in for an anime frame: a gradient no two of whose 8x8 blocks share a color, lit to its
 * edges so a trim keeps it whole.
 */
export const frame = (width = 640, height = 360): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      data[at] = Math.floor(x * 255 / width)
      data[at + 1] = Math.floor(y * 255 / height)
      data[at + 2] = 40 + ((x + y) % 97) * 2
      data[at + 3] = 255
    }
  }
  return { data, width, height }
}

/** `inner` centred in a black picture of `width` by `height`, as a phone screenshot of a video holds it. */
export const letterboxed = (inner: Pixels, width: number, height: number): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let at = 3; at < data.length; at += 4) data[at] = 255
  const left = Math.floor((width - inner.width) / 2)
  const top = Math.floor((height - inner.height) / 2)
  for (let y = 0; y < inner.height; y++) {
    data.set(inner.data.subarray(y * inner.width * 4, (y + 1) * inner.width * 4), ((top + y) * width + left) * 4)
  }
  return { data, width, height }
}

/** `shot` with a phone's lit clock and battery along its top and its home indicator along its bottom. */
export const withPhoneChrome = (shot: Pixels): Pixels => {
  const data = new Uint8ClampedArray(shot.data)
  const light = (left: number, top: number, width: number, height: number) => {
    for (let y = top; y < top + height; y++) data.fill(255, (y * shot.width + left) * 4, (y * shot.width + left + width) * 4)
  }
  light(16, 12, 40, 14)
  light(shot.width - 56, 14, 40, 10)
  light((shot.width - 140) / 2, shot.height - 20, 140, 5)
  return { ...shot, data }
}
