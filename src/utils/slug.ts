// No imports: the app, its worker and the link preview Function share it.

// Latin letters NFKD leaves whole, written as English writes them
const SPELLED: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', ł: 'l', þ: 'th', ı: 'i', ħ: 'h', ŧ: 't', ŋ: 'ng' }
const MAX = 60

/**
 * The name `title` gives an address: lower case, a Latin letter as plain ASCII, any other letter kept as it is, and
 * every run of anything else one '-', cut at a word to 60 characters. Empty when `title` has no letter or digit.
 */
export const slugOf = (title?: string | null): string => {
  const slug = (title ?? '').normalize('NFKC').toLowerCase().replace(/['’ʻʼ]/g, '')
    // a letter with its marks: a mark on a Latin letter goes, a mark on any other is part of the letter
    .replace(/[\p{L}\p{N}]\p{M}*/gu, letter => {
      const plain = letter.normalize('NFKD').replace(/\p{M}/gu, '')
      return /^[a-z0-9]+$/.test(plain) ? plain : SPELLED[letter] ?? letter
    })
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
  const characters = Array.from(slug)
  if (characters.length <= MAX) return slug
  const head = characters.slice(0, MAX + 1).join('')
  const word = head.lastIndexOf('-')
  return word > 0 ? head.slice(0, word) : characters.slice(0, MAX).join('')
}

/** `slugOf(title)` as the last segment of an address, percent-encoded, or '' when it is empty. */
export const nameSegment = (title?: string | null): string => {
  const slug = slugOf(title)
  return slug ? `/${encodeURIComponent(slug)}` : ''
}
