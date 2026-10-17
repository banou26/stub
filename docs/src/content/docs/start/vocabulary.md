---
title: Vocabulary
description: 'The words every other page uses without redefining them: uri, aggregated uri, handle, relation, scope, run, container, claim, row, cluster, component, aggregate, view and tier.'
---

Sixteen words, each with the function that produces the thing and the line that decides it. Every
other page on this site assumes these and will not stop to explain them again.

Read them in the order below. They stack: a **uri** names a row, a **claim** about two uris becomes a
**component**, the rows of that component are a **cluster**, and a **view** of the cluster is what a
page actually renders.

## origin, id, uri

A **uri** is `origin:id`. `` type Uri = `${string}:${string}` `` (`src/utils/uri.ts:3`), and the split is
positional rather than parsed: `originOf` is `uri.slice(0, uri.indexOf(':'))` (`src/worker/store/db.ts:44`).

The **origin** is the short name a source publishes under: `anilist`, `cr`, `mal`, `jw`, `imdb`. The
**id** is whatever that source calls the thing, verbatim, including its own punctuation:
`cr:G24H1N3MP-GS00374452` is one Crunchyroll season, and the hyphen inside it is Crunchyroll's series
id joined to its season id, not a separator this codebase owns.

A uri names **one source's row**. It never names a work. That is the next word.

## aggregated uri

An **aggregated uri** names a work as a *cluster of source rows*:
`ag:(anilist:166873,cr:G24H1N3MP-GS00374452)`. The type is
`` `ag:(${Uris})${''|`-${string}`}` `` (`src/utils/uri.ts:95`) and everything about it is read back by
one regex, `SCANNARR_REGEX = /ag:\((.*)\)(?:-(.*))?/` (`src/utils/uri.ts:97`).

Why a page never links to the plain uri, `src/utils/uri.ts:107-119`:

> The routable form of a work's uri: an aggregate, even when only one source is known.
>
> A relation and a graph node name a work by the SOURCE that mentioned it, `anilist:166873`, because
> that is all the naming source could say. Linking straight to it opens a page pinned to one source:
> the store has a single row to work with, so no other source is ever asked and the page shows
> whatever AniList alone knows. Wrapped as `ag:(anilist:166873)` it is the same work asked as a
> CLUSTER, which is the form the store keeps resolving: it fans out to the other sources, folds in
> whatever answers, and the modal rewrites its own address as the cluster grows.

```mermaid
flowchart TD
  classDef irrev fill:#fbeae7,stroke:#b03f33,color:#2e1a18
  classDef ratchet fill:#faf1e0,stroke:#8f5a0e,color:#2d2415
  classDef view fill:#e9eef7,stroke:#4572b5,color:#16202e
  classDef refuse fill:#f1f1f1,stroke:#b6b6b6,color:#4a4a4a

  subgraph shapes["the two shapes a name comes in"]
    direction LR
    S1["anilist:166873"] --> S1O["origin: anilist<br/><small>uri.slice(0, uri.indexOf(':'))</small>"]
    S1 --> S1I["id: 166873<br/><small>the source's own string, punctuation and all</small>"]
    S2["ag:(anilist:166873,cr:G24H1N3MP-GS00374452)-118"] --> S2P["origin: ag<br/><small>a literal prefix, not a source</small>"]
    S2 --> S2L["the handle list<br/><small>sorted by id, then by origin</small>"]
    S2 --> S2E["episode tail: 118<br/><small>optional, SCANNARR_REGEX group 2</small>"]
  end

  IN["a string that has to become routable<br/><small>asAggregatedUri, uri.ts:120</small>"] --> D1{"is it already an aggregate?<br/><small>isAggregatedUri(uri)</small>"}
  D1 -->|"ag: prefix and the list parses"| KEEP["returned untouched"]
  D1 -->|"not an aggregate"| D2{"can the id survive a route segment?<br/><small>colon &gt; 0 && !UNROUTABLE_IN_ID.test(uri.slice(colon + 1))</small>"}
  D2 -->|"refused: a comma, slash or bracket after the first colon"| KEEP2["returned untouched, never wrapped"]
  D2 -->|"routable"| D3{"exactly two non-empty colon parts?<br/><small>parts.length === 2</small>"}
  D3 -->|"one part, or none"| KEEP2
  D3 -->|"a uri"| WRAP["toAggregatedUri, giving ag:(anilist:166873)"]
  DIRECT["a caller that asks isUri on its own<br/><small>isUris uri.ts:90, decodeRouteUri uri.ts:163</small>"] --> D3
  D3 -->|"a comma inside the id"| THROW["throw: Invalid uri, contains ',' character in id"]

  class KEEP,KEEP2,THROW refuse
```

*The only `throw` in the file sits on a branch `asAggregatedUri` can never take: `UNROUTABLE_IN_ID` refuses a comma one decision earlier, so the throw is reachable only from a direct caller of `isUri`.*

Three validators, three different refusals, and none of them agree on what a uri is
(`src/utils/uri.ts:71-105`):

- `isUri` counts colon-separated non-empty parts and answers on `parts.length === 2`. It **throws** on
  `parts[1]?.includes(',')` (`:77`). It accepts `https://example.test/x` as origin `https`, which is
  exactly why `asAggregatedUri` asks `isRoutableUri` first (`:122-125`).
- `isRoutableUri` refuses `UNROUTABLE_IN_ID = /[,/()]/` anywhere after the first colon (`:83-88`). The
  comment says what each character costs: *"a ',' splits the handle list inside `ag:(...)` and a '/'
  splits ONE segment of a route path ('/watch/:mediaUri/:episodeUri'), so either one silently turns a
  working uri into one no route matches"*.
- `isAggregatedUri` returns true for `ag:()`. `match[1]` is the empty string, so `!uris` short-circuits
  the list check (`:104`).

:::caution[The empty aggregate is valid]
`ag:()` passes `isAggregatedUri`, parses to `handleUris: []`, and produces a media subscription that
stays open and yields nothing. Nothing anywhere refuses it.
:::

:::caution[Two producers, two encodings]
`toAggregatedUri` runs its content through `encodeURI` (`uri.ts:175-197`); `buildAggregatedIdentity`
in `aggregate.ts:296-303` joins the sorted uris raw. Both mint `ag:(...)` strings and they are not
byte-identical for an id containing anything `encodeURI` touches.
:::

## handle, and the two relations

A **handle** is one row pointing at another row, plus a word for what that pointing means:

```graphql
type MediaHandle {
  """The related row. Carries its own uri, origin, id and url."""
  node: Media!
  """What this edge asserts. Only SAME_AS unions clusters."""
  relation: MediaHandleRelation!
}
```

(`src/worker/resolvers/media/schema.gql:226-231`.) A handle is an **identity claim**, and there are two
completely separate enums in this codebase whose values both get called "relation" in conversation.
They must never be confused, and this is the figure that keeps them apart.

```mermaid
classDiagram
  direction LR

  class MediaHandle {
    +Media node
    +MediaHandleRelation relation
  }
  class MediaHandleRelation {
    <<structural: identity and containment>>
    SAME_AS
    PART_OF
  }
  class Relation {
    +MediaRelation relation
    +Uri uri
    +string format
    +Title titles
    +Cover covers
  }
  class MediaRelation {
    <<narrative: how a story connects>>
    ADAPTATION
    PREQUEL
    SEQUEL
    PARENT
    SIDE_STORY
    CHARACTER
    SUMMARY
    ALTERNATIVE
    SPIN_OFF
    SOURCE
    COMPILATION
    CONTAINS
    OTHER
  }
  class UnionFind {
    <<no inverse, no split>>
    +link
    +component
  }
  class DirectedEdge {
    <<unions nothing>>
    +edge
    +targets
  }
  class NoPath {
    <<never reaches either>>
  }

  MediaHandle --> MediaHandleRelation : one of two values
  Relation --> MediaRelation : one of thirteen values
  MediaHandleRelation --> UnionFind : claimed === 'SAME_AS' && mediaScope === handleScope
  MediaHandleRelation --> DirectedEdge : mediaScope !== handleScope, whatever was claimed
  MediaRelation --> NoPath : stored flat on the row, read by no clustering code
```

*Two values on the left union clusters or hang edges; thirteen on the right do neither, by construction.*

The store's own statement of the split, `src/worker/store/types.ts:31-37`:

> How one work relates to another as a STORY, mirroring `MediaRelation` in the graphql schema.
>
> The OTHER axis from `HandleRelation`, and the distinction is load bearing: nothing here may ever
> union a cluster, because a sequel is a different work. See the enum's own doc in
> `worker/resolvers/media/schema.gql`.

And the schema's, `src/worker/resolvers/media/schema.gql:116-120`:

> That enum answers "are these the same thing", this one answers "how does this story connect to that
> one", and the schema has kept them apart deliberately since the handle enum was written: PREQUEL says
> nothing about sameness and SAME_AS says nothing about story order. Nothing here may ever union a
> cluster. A sequel is a DIFFERENT work, and treating one as the same row is the mistake that merged
> three Mushoku Tensei seasons when it was made with SAME_AS.

`handleRelationEnum` is `['SAME_AS', 'PART_OF']` (`types.ts:28`). `mediaRelationEnum` is thirteen
values (`types.ts:38-41`), stored flat as `Relation` rows on the media (`types.ts:52-65`) precisely so
that no second copy of the other work enters the store's identity space.

:::danger[SAME_AS has no inverse]
`SAME_AS` is the only relation that unions, in `upsertMedia`, through `graph.link`
(`src/worker/store/graph.ts:279`). `graph.link` is a union-find. There is no `unlink`, no `split`, no
`disunion` anywhere in the repo, and `union` deletes the record of which members came from which side
(`graph.ts:82-105`). Once two rows are welded they stay welded for the life of the worker.

The schema says it in one sentence, `schema.gql:80-85`: *"The handle names THIS run. The only relation
that unions clusters, in `upsertMedia`, and the union has NO INVERSE: once two media are welded they
stay welded for the session. Minting this for an id that names a SHOW is the single most expensive
mistake available here. It merged three Mushoku Tensei seasons, four Demon Slayer films and fifteen
Dragon Ball Z films, each time because one id was the only thing a source could offer and the only
relation was this one."*
:::

`PART_OF` is the honest alternative when a source has only a show-level id. `partOf`
(`src/sources/utils.ts`) is one line and it does two things: it wraps the node in a `PART_OF` handle
**and** it stamps the copy `scope: 'CONTAINER'`, which is the next word.

## scope, run, container

**Scope** decides which identity space a row's `SAME_AS` claims union in. Two values,
`mediaScopeEnum = ['RUN', 'CONTAINER']` (`types.ts:87`), documented in `schema.gql:100-111`:

> Which kind of thing a row names, and so which identity space its SAME_AS claims union in.
>
> Sameness is only ever asserted within one scope. A claim that crosses scopes is read as PART_OF,
> whatever the producer asked for: a run is part of its show, never the same thing as it.

- **RUN**: *"One broadcast run: a cour, a film. The unit this store aggregates and the unit a card
  shows."* (`schema.gql:107`.)
- **CONTAINER**: *"A show, a series, a franchise page: something several runs are part of."*
  (`schema.gql:109`.)

Scope is not stored per claim. It is read off the uri at write time by `scopeOf`
(`src/worker/store/db.ts:91-92`), a three-step ladder: `SHOW_LEVEL_ORIGINS.has(originOf(uri))` first,
then the stored row's own `scope`, then `'RUN'` as the default. `SHOW_LEVEL_ORIGINS` has exactly one
member, `new Set(['imdb'])` (`db.ts:42`).

`sameAsLabelFor` (`db.ts:94`) turns a scope into the union-find label, and it is total: `CONTAINER`
gives `container:same_as`, everything else gives `media:same_as`. The three identity spaces are
`MEDIA_SAME_AS = 'media:same_as'` (`db.ts:14`), `CONTAINER_SAME_AS = 'container:same_as'` (`db.ts:15`)
and `EPISODE_SAME_AS = 'episode:same_as'` (`db.ts:45`). They are separate union-find instances, so a
union in one is invisible in the others.

:::danger[The scope ratchet is one way]
`const scope: MediaScope = scopeOf(media.uri) === 'CONTAINER' ? 'CONTAINER' : media.scope ?? 'RUN'`
(`db.ts:146`). Once any row for a uri said `CONTAINER`, no later row moves it back, and the comment at
`db.ts:142-145` says why the asymmetry is deliberate: *"The failure with no inverse is a wrong SAME_AS,
and the failure of a wrong CONTAINER is a missing SAME_AS, which a later slice can recover. The merge
function alone would let an incoming RUN overwrite it (scalars are last-write-wins)."*
:::

## claim

A **claim** is a handle flattened into a pair of uris on its way to the store:

```ts
type Claim = { mediaUri: string; handleUri: string; relation?: HandleRelation }
const claimKey = ({ mediaUri, handleUri, relation }: Claim) => `${mediaUri}\0${handleUri}\0${relation ?? 'SAME_AS'}`
```

(`src/worker/store/db.ts:110-111`.) The relation rides all the way down because it is the store, not
the source, that acts on it: the store derives the outcome from the two uris' scopes plus the claimed
relation, and only one of the four cells is a union. A claim naming a uri no row describes yet is not
applied and not dropped: it is deferred under each missing end and retried when a row lands
(`db.ts:113-130`, `:177-183`).

## row, cluster, component, aggregate

These four are the ones most often used interchangeably in conversation. They are four different
things.

```mermaid
flowchart TD
  classDef irrev fill:#fbeae7,stroke:#b03f33,color:#2e1a18
  classDef ratchet fill:#faf1e0,stroke:#8f5a0e,color:#2d2415
  classDef view fill:#e9eef7,stroke:#4572b5,color:#16202e
  classDef refuse fill:#f1f1f1,stroke:#b6b6b6,color:#4a4a4a

  ASK["a uri to look up<br/><small>findAggregatedMedia, db.ts:257</small>"] --> RES["graph.resolve(uri)<br/><small>aliases.get(key) ?? key</small>"]
  RES --> DLAB{"is the resolved key a media row?<br/><small>!graph.labeled('media').has(resolved)</small>"}
  DLAB -->|"an episode cluster id, or nothing stored"| REF["return an empty array<br/><small>no cluster, nothing thrown</small>"]
  DLAB -->|"a media row"| DSCOPE{"which identity space?<br/><small>sameAsLabelFor(scopeOf(resolved))</small>"}
  DSCOPE -->|"scope CONTAINER"| SPC["container:same_as"]
  DSCOPE -->|"scope RUN, or none stored"| SPR["media:same_as"]
  SPC --> DUF{"was the key ever linked in that space?<br/><small>uf?.has(start) ? uf.component(start) : undefined</small>"}
  SPR --> DUF
  DUF -->|"linked"| COMP["the COMPONENT: every member key<br/><small>a linked key with no row is silently skipped</small>"]
  DUF -->|"never linked"| SOLO["the start key alone"]
  ROWS[("graph.nodes: one ROW per uri<br/>merged by lastWriteLongestArray")] --> COMP
  ROWS --> SOLO
  COMP --> CLUSTER["the CLUSTER: the Media rows that exist<br/><small>Media[], never the key set</small>"]
  SOLO --> CLUSTER
  CLUSTER --> AGG["aggregateMedia(cluster, locationOrigin)"]
  AGG --> OUT["the AGGREGATE: one GQLMedia<br/><small>uri = ag:(member uris, sorted)</small>"]
  AGG -.->|"mints a uuid, on a read"| CID["graph.componentId(uris[0], IDENTITY_LABELS[space])<br/><small>the aggregate's _id, never a member's uri</small>"]

  class REF refuse
  class CLUSTER,AGG,OUT view
```

*The component lives in the union-find and outlives the call; the cluster, the aggregate and its uri are computed per call and thrown away. The one dashed arrow is the read that writes.*

- A **row** is one source's `Media`, keyed by its uri in `graph.nodes` (`graph.ts:124`). A second write
  for the same uri does not replace it, it merges through `lastWriteLongestArray` (`graph.ts:388`):
  scalars last-write-wins but only a non-nullish one, arrays strictly longest-wins.
- A **component** is a set of *keys* in one union-find (`graph.ts:107`). It can contain keys with no
  row at all: `graph.link` calls `uf.find`, which calls `ensure`, so linking a uri that was never `set`
  creates a member for it (`graph.ts:61-67`, `:279-291`).
- A **cluster** is the *rows* of a component. `graph.cluster(start, label)` (`graph.ts:316-330`) walks
  the component and pushes `nodes.get(key)` only when there is one, so a rowless member disappears from
  the cluster while staying in the component forever. When the key was never linked it returns the
  single row, or nothing.
- An **aggregate** is one `GQLMedia` computed from a cluster by `aggregateMedia`
  (`aggregate.ts:306`). It throws on an empty cluster (`:307`) and it is the only object on the read
  path whose `_id` is not a uri.

The `_id` rule, `aggregate.ts:290-294`:

> Keyed on the union-find ROOT of the cluster's identity space, never on a member: the smallest uri
> moved whenever a member sorting before it landed, and the container cut in `findAllAggregatedMedia`
> handed the same cluster a second id. Any member maps to the same root.

Note the asymmetry: an aggregated media's `_id` is a `componentId` uuid, while an inflated relation
keeps its own uri as `_id` (`aggregate.ts:195`), *"and `_id` is its uri rather than a cluster id for
exactly that reason"*, the reason being that nothing downstream may treat it as a row this store holds.

:::danger[componentId is a write during a read]
`graph.componentId` (`graph.ts:234-244`) mints a `crypto.randomUUID()` and registers it in the alias
table the first time a component is aggregated. The doc at `graph.ts:39-44`: *"minted once per
component, carried across unions (the survivor keeps its id; when both sides had one the larger
component's wins, ties to the lexicographically smaller root, and the other id becomes an alias of the
survivor), and dropped by `clear`."* The losing uuid is never deleted, so an `_id` a client is still
holding resolves to the survivor after a merge.
:::

## view

A **view** is anything computed per read and thrown away. The whole store divides on this line, and the
cleanest statement of it is `alignRunEpisodes` explaining why it will not write its own result,
`src/worker/store/consensus.ts:247-250`:

> READ TIME, AND A COPY. The stored node keeps Crunchyroll's own number, because it is keyed by
> Crunchyroll's guid and is reachable through the whole season from other paths: `graph.set` is
> last-write-wins, so rewriting it here would change what those other readers see. What the run needs
> is a VIEW, and a view is what this returns.

Views on the read path: `aggregateMedia`, `aggregateEpisode` (`aggregate.ts:306`, `:401`),
`mergeByEpisodeNumber` (`db.ts:475`), `alignRunEpisodes` and `runEpisodes` (`consensus.ts`),
`findPartOfMedia` (`db.ts:276`), `applyMediaFilters`, `exportStore`. Not views, whatever they look
like: `graph.link`, `graph.set`, the scope ratchet, `graph.componentId`, and
`fuzzyMergeMediaClusters` running inside a page read.

## tier

A **tier** is a score band, and the store's numeric consensus is **lexicographic across tiers, never
additive**. `tieredConsensus` (`consensus.ts:36-58`) takes the best score present,
`const tier = Math.max(...stated.map(claim => claim.score ?? 0))` (`:44`), keeps only the claims at
exactly that score, and lets the most-supported value among those win. Nothing below the top tier is
consulted at all.

Why a sum was rejected, `consensus.ts:12-22`:

> SO THE TIERS ARE LEXICOGRAPHIC, NEVER ADDITIVE. The best score present decides which claims are
> looked at; among those, the value the most of them claim wins; nothing below that tier is consulted
> at all. A source cannot be outvoted by any number of sources beneath it.
>
> A SUM WAS TRIED FIRST AND IS WRONG, measured three ways on 2026-09-09:
>
>   Mushoku Tensei S1 part 1, once the streaming tier echoes Crunchyroll's packaging:
>     24 scores cr 0.5 + jw 0.2 + nf 0.2 + appletv 0.2 + paramount 0.2 = 1.3
>     11 scores mal 0.9 + kitsu 0.3                                    = 1.2
>   and the sum publishes the folded 24, which is the defect it was written to stop. Five catalogues
>   restating one packaging is one witness counted five times.

An unscored row is its own tier at the bottom, because `claim.score ?? 0` reads a missing score as `0`
(`:42-45`).

## The whole vocabulary, in one table

| word | what it is | where it is decided |
| --- | --- | --- |
| origin | the short name a source publishes under | `db.ts:44` |
| uri | `origin:id`, naming one source's row | `uri.ts:3` |
| aggregated uri | `ag:(uri,uri)` with an optional `-episodeId` tail, naming a work | `uri.ts:95`, `:97` |
| handle | `{ node, relation }`: one row pointing at another, with a claim attached | `schema.gql:226` |
| handle relation | `SAME_AS` or `PART_OF`. Only `SAME_AS` unions | `types.ts:28`, `schema.gql:78` |
| media relation | thirteen narrative values. Unions nothing, ever | `types.ts:38`, `schema.gql:113` |
| scope | `RUN` or `CONTAINER`: which identity space a row's sameness unions in | `types.ts:87`, `db.ts:91` |
| run | one broadcast run: a cour, a film. The unit a card shows | `schema.gql:107` |
| container | a show, a series, a franchise page | `schema.gql:109` |
| claim | a handle flattened to `{ mediaUri, handleUri, relation? }` for the store | `db.ts:110` |
| row | one source's stored `Media`, merged field by field | `graph.ts:124`, `:388` |
| component | a set of keys in one union-find. May hold keys with no row | `graph.ts:107` |
| cluster | the rows of a component. Rowless members are skipped | `graph.ts:316` |
| aggregate | one `GQLMedia` computed from a cluster, `_id` a component uuid | `aggregate.ts:306`, `:293` |
| view | anything computed per read and never written back | `consensus.ts:247` |
| tier | the top score band, the only one a numeric consensus consults | `consensus.ts:44` |

## Where this page corrects the brief

The page inventory describes `graph.cluster(uri, label)` as producing "a component". It does not. The
component is the union-find's key set (`graph.ts:107`); `graph.cluster` returns `T[]`, pushing a node
only when `nodes.get(key)` is truthy (`graph.ts:322-323`). The difference is not cosmetic: `graph.link`
accepts a uri that was never stored, so a component can carry a member that no cluster, and therefore
no aggregate, will ever show. `upsertMedia` prevents that upstream with `pendingClaims`;
`upsertEpisodes` does not.
