---
title: Why it exists
description: A show-level link is true as containment and false as identity. similarMedia is the third option between dropping the link and welding every season of the show.
---

Kitsu knows that `kitsu:49002` streams on Crunchyroll. What it publishes to say so is
`crunchyroll.com/series/G24H1N3MP/...`, and it publishes the **same** url on `kitsu:45950` and
`kitsu:47694`, two other runs of the same show. The url is true. The id inside it names the series,
not the cour.

That is the whole problem, and it is not a matter of precision. A handle is an identity claim, and
`graph.link` is a union-find union with no inverse (`src/worker/store/graph.ts:279-291`). Minting
`cr:G24H1N3MP` as `SAME_AS` on all three records does not produce three slightly wrong rows. It
produces **one** media where there were three, for the rest of the session.

`similarMedia` is the third option. Hand the show id back to the origin that owns it, say what the
cluster knows about our run, and take the run that origin names.

## The dilemma

```mermaid
flowchart TD
  P["kitsu:49002, one cour of Mushoku Tensei<br/><small>its streams carry crunchyroll.com/series/G24H1N3MP/</small>"]
  P --> D1{"does this id name the thing the record is?<br/><small>attr.subtype === 'movie' && mintableAsFilmHandle(pointer)</small>"}

  D1 -->|"a film, on a host giving every title its own id"| FILM["sameAs(makeMedia(...))<br/><small>netflix /title/&lt;id&gt; is the whole of that list today</small>"]
  D1 -->|"a series id on a cour: nothing here names our run"| D2{"what may a show-level pointer become?<br/><small>true as containment and false as identity</small>"}

  D2 -->|"option 1: mint it anyway, the pre-2026-09-04 default"| WELD["graph.link(kitsu:49002, cr:G24H1N3MP, media:same_as)<br/><small>kitsu:45950, kitsu:47694 and kitsu:49002 become one media</small>"]
  D2 -->|"option 2: drop the pointer"| DROP["no handle and no url<br/><small>a real Crunchyroll offer is lost</small>"]
  D2 -->|"option 3, and what the code does: container(pointer)"| PART["partOf(makeMedia(...))<br/><small>{ node: { ...node, scope: 'CONTAINER' }, relation: 'PART_OF' }</small>"]

  PART --> EDGE["graph.edge(kitsu:49002, cr:G24H1N3MP, media:part_of)<br/><small>containment, directed, unions nothing</small>"]
  EDGE --> ASK["the worker asks cr on the run's page, with the cluster's evidence<br/><small>resolveSimilarRuns, once per (run cluster, container) pair</small>"]
  ASK --> R{"did that origin name one of its own runs?<br/><small>answer.origin === origin && answer.scope !== 'CONTAINER' && answer.id !== showId</small>"}

  R -->|"refused: not-a-run, or the ordinary null"| NOTHING["nothing is claimed<br/><small>the PART_OF edge stands: the url survives, the identity claim does not</small>"]
  R -->|"answered: cr:G24H1N3MP-GS00374452"| HONEST["graph.link(kitsu:49002, cr:G24H1N3MP-GS00374452, media:same_as)<br/><small>a run id, verified against our evidence, unions like any other</small>"]

  class WELD irrev
  class HONEST irrev
  class DROP refuse
  class NOTHING refuse

  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4
```

*Both rose nodes are the same call. The top one welds three runs on a guess and the bottom one welds two ids that were checked against each other, which is the only difference between them and it is the entire subsystem. The second rhombus is a design decision rather than a runtime branch, and its second line is the sentence in the file that settles it.*

The first decision is real code, split across a branch and a ternary at
`src/sources/kitsu/extractor.ts:100-105`: `attr.subtype === 'movie'` selects the mintable path, and
`mintableAsFilmHandle(pointer)` decides per pointer inside it. Everything else falls to
`container(pointer)` at `:96`, which is `partOf(makeMedia({ origin, id, url }))`.

The second decision is the argument. `src/sources/kitsu/extractor.ts:76-93`:

> Kitsu's streaming links, spent two ways depending on what the id can honestly claim.
>
> MINTED DIRECTLY when the record is a film AND the link is one of the few (origin, path segment)
> pairs measured to carry a per-title id. Netflix is the whole of that list today: it gives every
> title its own `/title/<id>`, so a film's Netflix link names the film.
>
> CARRIED AS PART_OF for everything else, because the show id is true as containment and false as
> identity. Kitsu publishes the same `crunchyroll.com/series/G24H1N3MP/...` on kitsu:45950,
> kitsu:47694 and kitsu:49002, three different runs of Mushoku Tensei, so minting it welds all three
> permanently; a film published under a series page is part of that series too. The precise run is
> not asked for here: the WORKER asks the owning origin on the run's page, once per run and container,
> with the whole cluster's evidence (the best day-precise date, every title, the highest-scored count,
> the episode titles), which is more than this record knows at handle time and is spent on no listing.
>
> DROPPED never. An id this source cannot read is not a pointer at all (see `streamPointers`), and
> every pointer is at least a link to the show the run is part of.

`partOf` is where the scope stamp goes on. `src/sources/utils.ts`, above the one-line function:

> THIS IS THE SCOPE STAMP. A PART_OF target is by definition a container of this run, so the node goes
> out as a copy scoped CONTAINER whatever it said, and the store then keeps it out of every run's
> identity space for good (scope is sticky toward CONTAINER there). The input is left untouched.

And the module header of `similarMedia` itself, `src/worker/extractor.ts:176-192`:

> One origin, one show id, and evidence about OUR run; the answer is that origin's own run or nothing.
>
> WHY THIS EXISTS. Stub models a broadcast run; every catalogue models a show. A source holding a
> show-level link (Kitsu publishes Crunchyroll's `/series/<id>/` url on EVERY season record) has
> something true about the show and nothing it may honestly mint as a handle, because a handle is an
> identity claim and `graph.link` is a union-find union with no inverse. Dropping the link loses a
> real offer; minting it welds every season of the show. This is the third option: hand the show id
> back to the origin that owns it, say what we know about our run, and take the run it names, which
> IS an honest identity and links like any other.
>
> WHY EVIDENCE AND NOT A SEASON NUMBER. Season numbers do not agree across platforms: Netflix folds
> two cours into one season, JustWatch numbers by its own list, anime metadata says "Season 2 Part 2".
> An id minted by ordinal is a guess wearing a precise uri, and on 2026-09-05 two such guesses met in
> `nf:80987039-3`. What establishes sameness is decided in `sources/similar.ts`, once, and every
> answering source goes through it.
>
> THE SELECTION is `SIMILAR_MEDIA_DOCUMENT` in ./similar-document.ts, with what it selects and why.

Note what the fourth option would have been and why it is not on the figure. Computing a
season-scoped id from an ordinal (`cr:G24H1N3MP-s2`, `nf:80987039-3`) looks like the honest middle,
and it is not: it is option 1 with a longer uri. `src/sources/similar.ts:3-8`:

> A season number is a guess: no two catalogues number a show's seasons the same way (Netflix folds
> two cours into one season, JustWatch numbers by its own list, anime metadata says "Season 2 Part 2"),
> so a season-scoped id minted by ordinal is a guess wearing a precise uri, and the store unions it
> with no inverse. What may go on a union is VERIFIED sameness, and this module is where verification
> is defined: a caller describes its run, a source describes its seasons, and the pick below either
> establishes one season or refuses.

`nf:80987039-3` is that failing in the tree: two different runs of one show each computed the same
Netflix season-scoped id, and the union that followed had no inverse.

:::danger[The claim at the bottom of that figure cannot be taken back]
`upsertMedia` applies the claim at `src/worker/store/db.ts:193`:
`if (graph.link(mediaUri, handleUri, sameAsLabelFor(mediaScope))) changed = true`.

`link` finds both roots and calls `uf.union(a, b)` (`graph.ts:279-291`). The exported graph API is
`set, registerLabel, setLabel, labeled, get, has, alias, resolve, link, connect, neighbours, root,
componentId, edge, targets, sources, cluster, clusters, clear` (`graph.ts:377-382`). There is no
`unlink`, no split, and nothing inside the union-find recording which pair caused a merge. The only
undo is `clear()`, which is the whole store, so a wrong `SAME_AS` is permanent for the session and
the fix is a reload.

`graph.edge` is directed and unions nothing (`graph.ts:297`), which is why every guess in this
subsystem is routed onto one. `db.ts:171`: *Guesses go on edges, which are deletable; only asserted
sameness within one scope goes on a union.*
:::

## What each party knows

Neither side can answer alone, and that is not a limitation to be engineered away. The caller holds
an id in a space it cannot read; the source can read that space and has never heard of our run.

```mermaid
flowchart TD
  subgraph caller["the caller: worker/similar-consumer.ts, on a run's page"]
    direction LR
    C1["cr:G24H1N3MP<br/><small>a container uri, reached along a PART_OF edge</small>"]
    C2["every title, the best day-precise date,<br/>the count the page publishes, 200 episode titles<br/><small>runEvidence(cluster, episodeTitles)</small>"]
    C3{"is a run of that origin already in the cluster?<br/><small>if (origins.has(container.origin)) continue</small>"}
    C1 --> C3
    C2 --> C3
  end

  subgraph answerer["the source: sources/crunchyroll, at its own origin"]
    direction LR
    S1["every season of G24H1N3MP<br/><small>seasonCandidates(input.showId, ctx)</small>"]
    S2["per candidate: seasonNumber,<br/>episodeCount, premiere, episodeTitles"]
    S3{"did the evidence establish exactly one?<br/><small>if (within.length !== 1 || foldVetoed(evidence, within[0]!)) return undefined</small>"}
    S1 --> S2
    S2 --> S3
  end

  C3 -->|"the cluster already names it: nothing is owed"| SKIP["no ask is planned"]
  C3 -->|"only the container, so the caller cannot name the run"| SEND["SimilarMediaInput<br/><small>showId plus the evidence, and nothing else</small>"]
  SEND --> S1

  S3 -->|"zero or two premieres inside the 45 day window"| NUL["yield { similarMedia: null }"]
  S3 -->|"one: cr:G24H1N3MP-GS00374452"| BACK{"does the answer name OUR show?<br/><small>score &gt;= SHOW_TITLE_THRESHOLD</small>"}

  BACK -->|"best pair under 0.9: refused-by-title"| REF["nothing claimed<br/><small>the title set is remembered, a title landing later asks again</small>"]
  BACK -->|"0.9 or better"| CLAIM["upsertMedia([], [{ mediaUri, handleUri, relation: 'SAME_AS' }])"]

  class CLAIM irrev
  class SKIP refuse
  class NUL refuse
  class REF refuse

  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4
```

*Three refusals and one claim, and the claim is the only rose node. The show is decided twice: once upstream by the PART_OF edge the caller already holds, and once here on titles alone after the answer comes back, because the edge may have come from a fuzzy pass.*

Left side, `src/worker/similar-consumer.ts:167-177`. `runEvidence` reads the cluster sorted by score
descending and returns four fields: every member's titles deduped and filtered by
`!isOnlySeasonLabel(title)` (a bare `"Season 3"` names a position, never a show), `bestRunStartDate`
of the members' dates, `runLength(cluster)` for the count, and the episode titles capped at 200. The
count is deliberately the aggregate's own, `:172-173`:

> the same number the aggregate publishes, so a source is asked against what the page shows
> rather than a second opinion assembled here (store/consensus.ts)

The filter drawn as `C3` is `planSimilarAsks` at `similar-consumer.ts:154`. It reads `origins`, built
at `:147` from **every** cluster member rather than only the runs collected at `:144`.

Right side, `src/sources/crunchyroll/extractor.ts:552-559`. `seasonForShow` fetches the season list,
runs `pickSimilarSeason(input, candidates)` and returns the season it establishes, or nothing. The
condition on `S3` is Rule 1 verbatim (`src/sources/similar.ts:190`); it is one of five rules and the
rest are on [the rules](/similar/rules/). The contract it works under, `crunchyroll/extractor.ts:549-550`:

> Null is the expected answer for most shows and is never an error. Answering with the SERIES would
> put back exactly the show-level handle the caller came here to avoid minting.

The rhombus on the way back is `answerNamesOurShow`, `src/sources/similar.ts:310-320`, applied at
`similar-consumer.ts:248`. `SHOW_TITLE_THRESHOLD` is `0.9` at `similar.ts:303`, and `similar.ts:299-302`
says where the number came from:

> The score at which an answer's title names OUR show. The value crunchyroll's search gate measured
> (title-gate.test.ts): correct pairs 1.000, the nearest wrong pair 0.8135, a spin-off.

It exists because the show id was never verified either. `src/sources/similar.ts:10-12`:

> The rules decide WHICH season of a show and never WHICH show: the show id the caller holds settles
> that, and it came off a PART_OF edge whose container cluster the fuzzy title pass may have unioned
> on a listing. A wrong container union upstream is trusted here, so a pick is only as right as it.

## Where the ask lives, and why not in each source

Every source could ask this question about its own pointers, at handle time, without the worker
being involved. It does not, for four measured reasons.

```mermaid
flowchart LR
  Q{"where does the question get put?<br/><small>a source sees only its own view</small>"}

  Q -->|"rejected: inside each source's resolver"| SRC["what a source has at handle time"]
  SRC --> R1["kitsu has titles, a date and a count<br/><small>and no episode titles, which is Rule 2's whole input</small>"]
  SRC --> R2["justwatch would ask with JustWatch's numbering<br/><small>the very collision under repair</small>"]
  SRC --> R3["asks on every operation<br/><small>unless it remembers the policy itself</small>"]
  SRC --> R4["asks only for the pointers it happens to hold"]

  Q -->|"chosen: once, in the worker, after aggregation"| WRK["what the worker has after aggregation"]
  WRK --> W1["the best day-precise date across members"]
  WRK --> W2["every title, and ani.zip's episode titles"]
  WRK --> W3["the highest-scored episode count"]
  WRK --> W4["every container the run is PART_OF<br/><small>whatever source or fuzzy pass produced the edge</small>"]
  WRK --> POL{"does this root spend cross-source work?<br/><small>if (!policyFor({ context }).crossSource) return</small>"}

  POL -->|"MEDIA: crossSource true, a detail view"| GO["planSimilarAsks runs"]
  POL -->|"MEDIA_PAGE: crossSource false, a listing never asks"| NO["return, and nothing is asked"]

  class NO refuse

  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4
```

*The four boxes on each branch are the same four sentences, read as a loss on top and a gain underneath. The bottom rhombus is the only runtime branch on the figure, and it is what keeps the whole subsystem off listings.*

`src/worker/similar-consumer.ts:1-13`:

> The one place the app asks `similarMedia`: on a run's page, after aggregation, per (run cluster,
> container) pair, re-asked only when the question changes.
>
> The ask lives HERE rather than inside each source's resolver because a source sees only its own
> view (kitsu has titles, a date and a count but no episode titles at handle time; justwatch would ask
> with JustWatch's numbering, the very collision under repair), asks on every operation unless it
> remembers the policy, and asks only for the pointers it happens to hold. The worker sees the whole
> cluster: the best day-precise date across members, every title, the highest-scored episode count,
> ani.zip's episode titles, and every container the run is PART_OF whatever source or fuzzy pass
> produced the edge. `Subscription.media` is the only caller, which is what keeps this off listings.
>
> Pure of the extractor on purpose: worker/extractor.ts cannot load under vitest, so the asking and
> the claiming are here and the resolver only wires them.

The single call site is `src/worker/resolvers/media/index.ts:76`, inside the `read()` that
`Subscription.media` re-runs on every `media:changed`:

```ts
// a MEDIA root by construction: only this resolver runs it, so a listing never asks
void resolveSimilarRuns(cluster, root, { ask: askSimilar, implemented: implementsSimilarMedia })
```

`void`, so the page's yield never waits on it, and the whole body of `resolveSimilarRuns` is wrapped
in a `try` that catches into `console.error` (`similar-consumer.ts:280`, `:300-302`). It never throws
into the caller.

The policy gate on the figure is `similar-consumer.ts:281`, reading the table at
`src/worker/request-context.ts:59-63`:

```ts
const POLICY: Record<RootOperation, RequestPolicy> = {
  MEDIA: { crossSource: true },
  MEDIA_PAGE: { crossSource: false },
  SIMILAR_MEDIA: { crossSource: true },
}
```

A hop that arrives with no context at all reads `UNKNOWN_POLICY` (`request-context.ts:73`), which is
also `{ crossSource: true }` and increments a counter. Failing open there is deliberate; see
[the request context](/request/request-context/).

## What this page does not cover

Only the argument. The machinery is next door:

- [The consumer](/similar/consumer/): what the worker remembers per (run cluster, container) pair, and the cap on how many times one pair is asked.
- [The funnel](/similar/funnel/): the ladder between the consumer and the source, and the difference between `declined` and `refused`.
- [The rules](/similar/rules/): `pickSimilarSeason`, its five rules and two vetoes.
- [The document](/similar/document/): what the ask selects off the answer, and the Netflix incident that added the episode selection.
- [A run is not a show](/start/run-and-show/): the modelling mismatch this page starts from.
- [Scopes and relations](/write/scopes-and-relations/): the 2x2 that turns the claim at the bottom of the first figure into a union or an edge.
