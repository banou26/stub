// MyAnimeList's CDN serves three sizes of one picture, each as .jpg and .webp, and the small .jpg is
// the default spelling.
// Nothing here imports anything, so both the offline bundle and the jikan source can use it.

// `.../images/anime/1527/158340.jpg`, optionally with a size letter before the extension, or resized
// under `/r/116x180/` as the site's search answers spell it
const MAL_IMAGE = /^https:\/\/cdn\.myanimelist\.net(\/r\/\d+x\d+)?(\/images\/anime\/[^/]+\/\d+)[a-z]?\.\w+(\?.*)?$/

/**
 * The LARGE .webp variant of a MyAnimeList image url, or the url unchanged when it is not one.
 *
 * Measured 2026-09-06: the plain spelling is 225x318 and the `l` spelling is 425x600, nearly four
 * times the pixels, and the `l` file existed for every image sampled from the shipped bundle. Both
 * the manami bundle (`picture`) and jikan's season scrape (the page's `data-src`) hand over the plain
 * one, and jikan scores 0.9, above every other source, so its small cover sorted FIRST and replaced
 * AniList's larger one several seconds after the page had already drawn it. The owner saw exactly
 * that: "the cards image load fast and are really high quality, and then 5s later, the images changes
 * for a lower quality version".
 *
 * Measured 2026-10-13 on 119 covers from 1907 to 2027: every `l.webp` answered 200 image/webp where
 * `l.jpg` did, 3.8 MB against 11.4 MB, and no .webp was the larger file. Part of that saving is
 * quality: the .webp has the same pixel size but is re-encoded more lossily, a median 32.9 dB PSNR
 * against the .jpg (29.2 to 36.5 over 24 covers), near-identical on screen.
 *
 * A size letter already present is replaced rather than appended, so `...158340t.jpg` (the thumbnail
 * MAL uses in listings) upgrades too and `...158340l.webp` is returned as it came. A missing url
 * passes through: a source with no image is not this function's problem.
 */
export const malLargeImage = <T extends string | null | undefined>(url: T): T => {
  const match = url?.match(MAL_IMAGE)
  // a resized url's query is the signature of that size, which the plain file does not need
  return match ? `https://cdn.myanimelist.net${match[2]}l.webp${match[1] ? '' : match[3] ?? ''}` as T : url
}
