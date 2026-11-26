/** Returns `value` trimmed when it parses as an `http:` or `https:` URL; `undefined` otherwise. */
export const safeHttpUrl = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}
