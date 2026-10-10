# Stub

Shows, Movies, Anime, all in one place from your browser

stub merges show, movie and anime data from many sources into one page per title, and plays a source
inside your own signed in session on that site. It runs on the [FKN platform](https://fkn.app): FKN
carries its requests to each site, installs the sources you add and holds the rooms for watch
parties, so stub has no server of its own.

- Live at [anime.fkn.app](https://anime.fkn.app), and inside FKN at
  [fkn.app/app/npm:@banou/stub](https://fkn.app/app/npm:@banou/stub)
- Published on npm as [`@banou/stub`](https://www.npmjs.com/package/@banou/stub)

## What it does

- **Sources.** stub ships with catalogues such as AniList, MyAnimeList, Kitsu, TMDB, TVmaze, IMDb,
  Trakt, Simkl and TheTVDB, and with where to watch: Crunchyroll, Netflix, JustWatch, Watchmode and
  the main streaming services. The full list is `src/sources/built-in.ts`. Each one has a switch in
  Settings, under Sources, and all are on until you turn one off. No source asks you for an API key.
- **Added sources.** Settings, under Sources, also adds community sources published on npm: browse
  the ones made for stub, or add one by its address (`npm:@scope/package`). FKN installs each one,
  and it runs isolated from stub.
- **Playback.** Crunchyroll plays in stub's own player on your Crunchyroll account. Sign in once in
  Settings, under Accounts, through an FKN window, or let stub use your browser's own session with the
  FKN browser extension. Netflix needs the extension. An added source can play its own releases
  inside stub, in a frame of its own.
- **Tracking.** One row on each title saves your progress to AniList, MyAnimeList and stub's own
  list. AniList and MyAnimeList use your own accounts on those sites. stub's list stays on this
  device, or in your FKN account once you choose to add it there.
- **Watch together.** Start a watch party and share its link. Every guest's player follows the
  host's, and the party has a chat.
- **Search.** Search every source at once from the header, or narrow it on the search page by
  category, format, status, season, year, genre and tag, shown as covers, cards or a list.

## How it is built

- **UI**: Preact, routed with wouter and styled with Emotion, in `src/router` and `src/components`.
  urql is the GraphQL client.
- **Data**: a GraphQL Yoga server in a Web Worker (`src/worker`), reached from the page over
  [osra](https://github.com/banou26/osra). The schema is the `.gql` files under `src`, and
  `npm run gql-generate` writes the types to `src/generated`.
- **Sources**: one extractor per source, `src/sources/<name>/extractor.ts`, listed in
  `src/sources/index.ts`. Every request goes through `cloud.fetch` from `@fkn/lib`.
- **Merge**: `src/worker/store` joins the answers that describe the same title into one record. It
  lives in memory, so a reload starts fresh.
- **Player**: [`@banou/media-player`](https://www.npmjs.com/package/@banou/media-player) on its own
  page (`embed.html`, `src/embed.tsx`).
- **Docs**: `docs/` is a Starlight site that maps how data moves through stub, with diagrams.

## Development

Use Node 24 (`.node-version` names 24.21.0, which CI uses).

```sh
npm ci
npm run data:build     # the anime id data, from the newest manami release
npm run gql-generate   # the GraphQL types, into src/generated
npm run dev            # http://localhost:4560
```

`npm run data:build-offline` rebuilds the anime data from the last download instead of fetching it.

```sh
npm run type-check
npm run test:unit      # vitest, tests/unit
npm test               # the unit tests, a test build, then the Playwright specs in tests/*.spec.ts
npm run build          # the app and the npm entry, into build/
```

The Playwright specs run against a test server on port 7357, which `playwright.config.ts` starts.

A push to `main` publishes to npm when `package.json` names a version the registry does not have yet
(`.github/workflows/publish-lib.yml`).

### The docs site

```sh
cd docs
npm install
npm run dev     # http://localhost:4321
npm run build
```

`npm run check` builds the site and checks every diagram in a real browser. `docs/README.md` covers
what it needs and how to write a page.

## Writing a source

A source you add is an npm package that FKN runs isolated from stub and connects to it.
`examples/source-plugin` is a working one, a tiny static catalogue. Its contract is `StubSource` in
`src/plugin-api.ts`, and the docs site's Plugin sources page (`docs/src/content/docs/request/plugins.md`)
covers what stub checks on a source. Publish it with the keywords in the example's `package.json` and
it shows up under Browse sources in Settings. While you work on one, Settings also takes a local dev
address such as `localhost:4599`.

## Privacy

stub has no accounts and no server of its own, and runs no analytics. What it fetched stays in the
tab's memory until you reload. Your settings stay in your browser, and stub's list moves to your FKN
account only when you choose to, encrypted in your browser first. Sign-ins to Crunchyroll, AniList and
MyAnimeList are kept by FKN, or by your browser with the FKN extension, never by stub. The
[privacy page](https://anime.fkn.app/privacy) lists everything stub keeps, where and for how long
(`src/router/privacy`).

## License

MIT, as `package.json` declares.

<!--

Decisions to impl:

Sanitize data from the external sources handler, aka db side, not from the react UI
Offer markdown from the graphql API, not compute it from the react UI


## todo:

make it so that shortDescriptions use the description if unset

re-implement the title infer system for low count searches using smith waterman + sorensen dice coef = magic alignment

make inferred information (episode released so far based on start release date / weeks since then) special colors for the user to distinguish between factual information

use the sneedex api to get best quality sources https://sneedex.moe/api/public/nyaa

make use of Taiga's https://github.com/erengy/anime-relations list to try and infer as accurate episode number as possible.
4k res?:

- https://github.com/bloc97/Anime4K/issues/7
- https://github.com/bloc97/Anime4K/issues/106
- https://github.com/Duke-13/Test_AnimeSuperResolutionForChromeExtensions
- https://gist.github.com/Juszoe/4680d0cb18811a459cc7fa83214e499c#gistcomment-3259179
- https://gist.github.com/NeuroWhAI/ce524cdf6913fae5eee830561bf32f40

check out if https://github.com/jmir1/aniyomi has some nice sources

https://thewiki.moe/en/tutorials/unblock

IMPL MAL INTEGRATION // https://github.com/prince-ao/myanimelist-oauth/blob/main/lib/malOauth.js

https://unsplash.com/photos/3dnZdTseNKg

-->
