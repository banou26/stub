// What tests/watch-stage.spec.ts builds the page with in place of src/utils/fetch.ts, FKN's relay: Crunchyroll's skip
// events of the chapterless torrent's episode, its credits from 20 to 38 s where the other torrents' files mark their
// ending, and the bucket's 403 for any other, as for an episode with no file.
export const fetch = async (input: RequestInfo | URL) =>
  (input instanceof Request ? input.url : input.toString()) === 'https://static.crunchyroll.com/skip-events/production/GTORRENT2.json'
    ? Response.json({ credits: { start: 20, end: 38 } })
    : new Response('', { status: 403 })
