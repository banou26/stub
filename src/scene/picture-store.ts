// Ephemeral in-memory map from 28-char scene code to the original image Blob/File so
// live-action and hybrid scene searches can post the cropped frame to SauceNAO without
// persisting user images or embedding binary data into URLs.
const MAX_PICTURES = 10
const pictures = new Map<string, Blob>()

/** Associates `code` with `picture` in memory, evicting the oldest entry past `MAX_PICTURES`. */
export const rememberPicture = (code: string, picture: Blob): void => {
  pictures.delete(code)
  pictures.set(code, picture)
  while (pictures.size > MAX_PICTURES) {
    const oldest = pictures.keys().next().value
    if (oldest === undefined) break
    pictures.delete(oldest)
  }
}

/** Returns the in-memory picture remembered for `code`, or undefined on a reload or bare URL visit. */
export const readPicture = (code: string): Blob | undefined => pictures.get(code)

/** Clears remembered pictures (intended for unit tests). */
export const clearPictures = (): void => {
  pictures.clear()
}
