const MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]

export type BifFixtureOptions = {
  /** Index timestamps, one per image, in units of `separation`. */
  timestamps: number[]
  separation?: number
  /** Bytes appended after the last image, which the sentinel entry's offset must exclude. */
  trailer?: number[]
  /** Overrides the header's frame count, to write one that disagrees with the index. */
  count?: number
  /** Overrides the sentinel entry's timestamp. */
  sentinel?: number
}

/** A tiny stand-in image for frame `index`: a JPEG's SOI marker, then bytes naming the frame. */
export const fixtureImage = (index: number) => [0xff, 0xd8, index, index + 1, index + 2]

/** A BIF laid out as Crunchyroll's measured one is, around `fixtureImage` payloads. */
export const buildBif = ({ timestamps, separation = 1, trailer = [], count = timestamps.length, sentinel = 0xffffffff }: BifFixtureOptions) => {
  const images = timestamps.map((_, index) => fixtureImage(index))
  const indexEnd = 64 + (timestamps.length + 1) * 8
  const imageBytes = images.reduce((total, image) => total + image.length, 0)
  const buffer = new ArrayBuffer(indexEnd + imageBytes + trailer.length)
  const view = new DataView(buffer)
  MAGIC.forEach((byte, index) => view.setUint8(index, byte))
  view.setUint32(8, 0, true)
  view.setUint32(12, count, true)
  view.setUint32(16, separation, true)
  let offset = indexEnd
  timestamps.forEach((timestamp, index) => {
    view.setUint32(64 + index * 8, timestamp, true)
    view.setUint32(64 + index * 8 + 4, offset, true)
    new Uint8Array(buffer, offset, images[index]!.length).set(images[index]!)
    offset += images[index]!.length
  })
  view.setUint32(64 + timestamps.length * 8, sentinel, true)
  view.setUint32(64 + timestamps.length * 8 + 4, offset, true)
  new Uint8Array(buffer, offset, trailer.length).set(trailer)
  return buffer
}
