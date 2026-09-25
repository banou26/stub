/**
 * One image of a BIF (Roku's Base Index Frames), the storyboard Crunchyroll's own player draws its
 * seek preview from.
 *
 * `start` and `end` are milliseconds into the episode, and the image covers `[start, end)`. The last
 * image has no successor, so its `end` is `Infinity`: it holds to the end of the episode. `bytes` is
 * a view into the parsed buffer rather than a copy, one JPEG.
 */
export type BifFrame = {
  start: number
  end: number
  bytes: Uint8Array<ArrayBuffer>
}

/** A buffer that is not a BIF this parser can read, with what was wrong in `message`. */
export class BifParseError extends Error {
  override name = 'BifParseError'
}

const MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]
const HEADER_SIZE = 64
const ENTRY_SIZE = 8
const END_TIMESTAMP = 0xffffffff
// ten hours at a frame a second: a count past this is a corrupt header rather than a long episode
const MAX_FRAMES = 36_000

/**
 * Reads a BIF into its frames, in time order.
 *
 * The layout: the magic, a uint32 LE version at 8, the frame count at 12 and the framewise
 * separation at 16 (a millisecond multiplier for every timestamp, where 0 means 1000), reserved to
 * byte 64. Then `count + 1` index entries of (timestamp, offset), both uint32 LE, the last one
 * carrying timestamp 0xffffffff and the end offset of the last image. Each image runs from its own
 * offset to the next entry's.
 *
 * Throws a `BifParseError` on anything it cannot vouch for: bad magic, a truncated header or index,
 * an implausible count, an image outside the buffer or overlapping the index, or timestamps that do
 * not increase. It never returns a partial list.
 */
export const parseBif = (buffer: ArrayBuffer): BifFrame[] => {
  if (buffer.byteLength < HEADER_SIZE) throw new BifParseError(`truncated header: ${buffer.byteLength} bytes`)
  const view = new DataView(buffer)
  if (MAGIC.some((byte, index) => view.getUint8(index) !== byte)) throw new BifParseError('bad magic')

  const count = view.getUint32(12, true)
  const separation = view.getUint32(16, true) || 1000
  if (count > MAX_FRAMES) throw new BifParseError(`implausible frame count ${count}`)
  const indexEnd = HEADER_SIZE + (count + 1) * ENTRY_SIZE
  if (indexEnd > buffer.byteLength) throw new BifParseError(`truncated index: ${count} frames need ${indexEnd} bytes, have ${buffer.byteLength}`)

  const timestampAt = (index: number) => view.getUint32(HEADER_SIZE + index * ENTRY_SIZE, true)
  const offsetAt = (index: number) => view.getUint32(HEADER_SIZE + index * ENTRY_SIZE + 4, true)
  if (timestampAt(count) !== END_TIMESTAMP) throw new BifParseError('the index does not end on the 0xffffffff entry')

  const frames: BifFrame[] = []
  for (let index = 0; index < count; index += 1) {
    const offset = offsetAt(index)
    const next = offsetAt(index + 1)
    if (offset < indexEnd || next <= offset || next > buffer.byteLength) {
      throw new BifParseError(`image ${index} spans ${offset}..${next}, outside ${indexEnd}..${buffer.byteLength}`)
    }
    const timestamp = timestampAt(index)
    const last = index + 1 === count
    if (!last && timestampAt(index + 1) <= timestamp) throw new BifParseError(`timestamps do not increase at image ${index}`)
    frames.push({
      start: timestamp * separation,
      end: last ? Infinity : timestampAt(index + 1) * separation,
      bytes: new Uint8Array(buffer, offset, next - offset),
    })
  }
  return frames
}

/**
 * The frame to preview at `ms`: the last one starting at or before it. A time ahead of the first
 * frame gets the first frame, since Crunchyroll's storyboard starts at 10 s rather than at 0.
 */
export const bifFrameAt = (frames: readonly BifFrame[], ms: number): BifFrame | undefined => {
  if (!frames.length || !Number.isFinite(ms)) return undefined
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (frames[middle]!.start <= ms) low = middle
    else high = middle - 1
  }
  return frames[low]
}
