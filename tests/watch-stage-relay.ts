// What tests/watch-stage.spec.ts builds the page with in place of src/utils/fetch.ts, FKN's relay: Crunchyroll's skip
// events of the chapterless torrent's episode, its credits from 20 to 38 s where the other torrents' files mark their
// ending, the first episode's from 60 to 90 s with `stageSceneAfterEnding` on the window, and the bucket's 403 for any
// other, as for an episode with no file.
const events = (url: string) =>
  url.endsWith('/GTORRENT2.json') ? { credits: { start: 20, end: 38 } }
  : url.endsWith('/GSTAGE1.json') && 'stageSceneAfterEnding' in window ? { credits: { start: 60, end: 90 } }
  : undefined

export const fetch = async (input: RequestInfo | URL) => {
  const answer = events(input instanceof Request ? input.url : input.toString())
  return answer ? Response.json(answer) : new Response('', { status: 403 })
}
