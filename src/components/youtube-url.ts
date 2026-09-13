// Turning whatever url a source hands us into a YouTube video id.
//
// Its own module because the component that uses it embeds YouTube directly rather than loading
// `iframe_api`, so this parsing is ours now rather than the API's, and because a pure function is
// worth testing without a JSX runtime.

/** The video id out of any url shape a source hands us, or null when it is not a YouTube link.
 *
 *  The host is compared EXACTLY after stripping a leading `www.` or `m.`, never with a suffix test:
 *  `youtube.com.evil.example` ends with nothing useful and must not be embedded as though YouTube
 *  served it. */
export const youtubeVideoId = (url: string): string | null => {
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  const host = parsed.hostname.replace(/^(?:www|m)\./, '')
  if (host === 'youtu.be') return parsed.pathname.split('/')[1] || null
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null
  if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || null
  return parsed.pathname.match(/^\/(?:embed|v|shorts)\/([^/?#]+)/)?.[1] ?? null
}
