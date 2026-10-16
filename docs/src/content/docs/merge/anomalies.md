---
title: Anomalies
description: "Two rules that need no expected answer, because a cluster that trips one is claiming two things that cannot both be true. Seventy-one lines, no production caller, and the only thing in the tree that can be swept over every cluster at once."
---

Every other check on merging asks a question somebody already answered: these uris belong together,
those two never do, this run lists eleven episodes. That is the right way to pin a known answer and
the wrong way to find an unknown one. `src/worker/store/anomalies.ts` is the other half. It is
seventy-one lines holding two rules, and neither of them needs to be told what the right answer was.

`src/worker/store/anomalies.ts:4-14`

> Ways a cluster can be visibly wrong ABOUT ITSELF, without anyone having to say what it should be.
>
> The merge fixtures decide each case by hand: these uris together, those two never. That is the right
> way to pin a known answer and the wrong way to find an unknown one, because it only ever looks where
> somebody already looked. These rules need no expected answer, so they can be swept over every
> cluster in the corpus at once, and over a franchise walked live.
>
> Every rule here is a CONTRADICTION rather than a preference. A cluster that trips one is claiming
> two things that cannot both be true, which is why it is safe to run them everywhere.

The public surface is a type and one function. A finding is a `rule` and a `detail`, both strings
(`anomalies.ts:15`), and the entry point concatenates the two rules in a fixed order
(`anomalies.ts:69-71`):

```ts
/** Every anomaly in one cluster. An empty array is the only acceptable answer. */
export const clusterAnomalies = (cluster: readonly Media[], listed?: number): Anomaly[] =>
  [...disagreeingIds(cluster), ...overLength(cluster, listed)]
```

## Who calls this

Nothing in `src/` does. `clusterAnomalies` is imported by two tests:
`tests/unit/worker/store/merge-fixtures.test.ts:15`, which calls it once, at `:167`, and
`tests/unit/worker/store/anomalies.test.ts`, which pins the id rule case by case.
The module doc above says the rules can be swept "over a franchise walked live"; no walker in the tree
does that today, so read that sentence as a design intent rather than a description of a caller.

The caller that matters is the sweep, and the reason the sweep is separate from the hand-decided cases is worth
reading in the test's own words.

`tests/unit/worker/store/merge-fixtures.test.ts:149-156`

> THE SWEEP, and the reason it is separate from every case above.
>
> Each case decides one answer by hand, which pins what somebody already looked at. These rules
> need no expected answer: they are contradictions a cluster makes about ITSELF, so they run over
> every cluster the whole corpus produces, and a case added for one reason is checked for all of
> them. See store/anomalies.ts.

So every `MERGE_CASES` entry is checked twice: once against the answer it was written to pin, and once
against both rules here. A case added to hold two Grand Blue seasons apart is also asked whether any
cluster it produced now names two Crunchyroll ids, or lists more episodes than it is long.

## `disagreeingIds`: two ids of one origin

`src/worker/store/anomalies.ts:17-24`

> Two ids of one origin that are not the same id at different precision.
>
> One source names one thing once. Two of its ids in a cluster means a union happened that the source
> itself would refuse, and `graph.link` has no inverse, so it is permanent for the session. The
> precision case is real and must not be reported: `cr:G24H1N3MP` beside `cr:G24H1N3MP-GS00374452` is
> a series id and one of its seasons, `<a>` against `<a>-<something>`.

That is the contradiction in one sentence. Crunchyroll gave season 1 the id `G24H1N3MP-G609CX3J4` and
season 3 the id `G24H1N3MP-GS00374452` (`tests/unit/worker/store/merge-fixtures.ts:348-350`). If one
cluster holds both, Crunchyroll is being read as saying that two of its own seasons are one run, which
it never said. Nobody has to know which of the two the cluster should have been.

```mermaid
flowchart TD
  A["clusterAnomalies(cluster, listed)<br/><small>cluster is the member list findAggregatedMedia returned</small>"] --> B["disagreeingIds walks the cluster, member by member"]
  B --> C{"does this member name both an origin and an id?<br/><small>!media.origin || !media.id</small>"}
  C -->|"one of the two is missing, so it carries no id to compare"| SKIP["continue<br/><small>the member contributes nothing, the loop lives</small>"]
  C -->|"both present"| D["byOrigin: append media.id under media.origin<br/><small>then iterate [...byOrigin].sort(), so report order is fixed</small>"]
  D --> E{"did this origin put more than one row in the cluster?<br/><small>ids.length &lt; 2</small>"}
  E -->|"one row means one id: no origin can disagree with itself"| ONE["continue"]
  E -->|"two or more rows of one origin"| F{"is some other id here this id's own extension?<br/><small>!ids.some(other =&gt; other.startsWith(`${id}-`))</small>"}
  F -->|"a series id whose own season id is also here: precision"| DROP["dropped from specific<br/><small>the PARENT is dropped, never the child</small>"]
  F -->|"nothing here extends it, so it is as specific as this origin gets"| KEEP["kept in specific, then sorted"]
  KEEP --> G{"is more than one specific id left?<br/><small>specific.length &gt; 1</small>"}
  G -->|"one survivor: one run, named once, at one precision"| CLEAN["no anomaly<br/><small>an empty array is the only acceptable answer</small>"]
  G -->|"two ids that are different runs to that source"| OUT["push two ids of one origin<br/><small>cr names G24H1N3MP-G609CX3J4 and G24H1N3MP-GS00374452, which are different runs to that source</small>"]
  OUT -.->|"reports a union that graph.link already made"| WELD["the weld itself<br/><small>a union-find union: no split, no unlink, permanent for the session</small>"]
  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4
  class SKIP,ONE,DROP,CLEAN refuse
  class WELD irrev
```

*The rule reports; it never repairs. Every dim node is a path that ends without a finding, and the rose node is the thing the finding is about.*

The loop is `anomalies.ts:25-46`. The member skip is at `:28`, the grouping at `:29`, the group cut
at `:34`, the specificity filter at `:37` and the report at `:38-43`. The third decision node carries
that filter's predicate exactly as the file spells it, template literal and all.

:::danger[Nothing here undoes anything]
`graph.link` is a union-find union. There is no split, no unlink, and no inverse anywhere in the repo:
once two rows are in one component they stay there for the life of the worker. `disagreeingIds`
reports that a weld happened. It cannot take it back, and neither can the reader. The only repair is a
reload, which rebuilds the store from nothing.
:::

### Why the filter is one-way

The interesting line is `:37`, and the comment above it says exactly why it is shaped the way it is.

`src/worker/store/anomalies.ts:35-36`

> one-way: dropping both sides lets a shared parent hide the disagreement it sits between, so
> `[A, A-1, A-2]` would report nothing at all

The test is ``other.startsWith(`${id}-`)``, one id against the other's own extension. Two ids that
merely share a prefix (`G24H1N3MP` and `G24H1N3MPX`) are unrelated and stay a disagreement.

Read symmetrically, a cluster holding `A`, `A-1` and `A-2` has no surviving id at all: `A` is extended
by both children, and each child extends `A`. Everything is filtered out, `specific` is empty, and the
rule reports nothing about a cluster that has welded two seasons of one series together. Read one way,
only the parent goes.

| cluster ids | symmetric reading | one-way reading (what ships) |
| --- | --- | --- |
| `A`, `A-1` | `specific` empty, nothing reported | `A` dropped, `specific` is `[A-1]`, nothing reported. Correct: this is one source naming its run precisely |
| `A`, `A-1`, `A-2` | `specific` empty, **nothing reported** | `A` dropped, `specific` is `[A-1, A-2]`, **reported**. Two seasons of one series in one run |
| `A-1`, `A-2` | both survive, reported | both survive, reported |
| `G24H1N3MP`, `G24H1N3MPX` | both survive, reported | both survive, reported. A shared prefix is not an extension |

`tests/unit/worker/store/anomalies.test.ts` pins every row of that table.

### Two smaller decisions in the same loop

**A repeated id is not a disagreement with itself.** The group cut at `:34` reads the raw array
(`ids.length < 2`), while the filter at `:37` maps over `[...new Set(ids)]`. So a cluster holding two
rows of one origin with the same id passes the cut and then produces a one-element `specific`, which
reports nothing, and `tests/unit/worker/store/anomalies.test.ts` pins it.

**The report is deterministic.** `[...byOrigin].sort()` at `:33` sorts the origin groups, and
`.sort()` at the end of `:37` sorts the surviving ids, so the same cluster produces the same string on
every run whatever order the extractors answered in. That matters because the caller compares the
whole finding list against `[]`, and a list that reorders itself between runs is a flake.

## `overLength`: a run listing more than it is long

`src/worker/store/anomalies.ts:48-58`

> A run listing more episodes than its sources agree it is long.
>
> The one the membership rules cannot see, because the cluster is right about who it contains: an
> episode arrives attached to whichever media published it, so a member that packages this run inside
> a longer season brings that season's whole list. Mushoku Tensei season 1 part 1 listed 24 for an 11
> episode run this way (2026-09-09).
>
> `listed` is passed in rather than read, because counting it means walking the episode graph and
> these rules are pure.

This is the rule the other kind of check structurally cannot see. `together` and `apart` are
assertions about membership, and in this case membership is right: `anilist:108465`, `kitsu:42323`,
`anizip:14758` and `cr:G24H1N3MP-G609CX3J4` really are one run. The fold arrives as an episode list,
not as a member, so no membership assertion can express it.

Those are the numbers in the figure below. The first three members each publish `episodeCount: 11` and
Crunchyroll's season publishes 24 (`tests/unit/worker/store/merge-fixtures.ts:121-123` and `:348`), so
`runLength` answers 11 on anizip's 0.9 tier and three of the four members back it. Before the trim
existed, the page drew 24 numbered rows for that run.

The fixture that pins the case says the important half in capitals. It is named *a run lists its own
episodes, not those of the season a streamer folds it into*
(`tests/unit/worker/store/merge-fixtures.ts:377-391`).

`tests/unit/worker/store/merge-fixtures.ts:383-384`

> THE CLUSTER IS NOT WRONG ABOUT WHO IT CONTAINS, which is why `together` and `apart` cannot
> see this: the fold arrives as an episode list, not as a member.

Nine lines (`anomalies.ts:59-67`), and all three of its refusals sit on one of them:

```mermaid
flowchart LR
  IN[("findRunEpisodes(cluster)<br/><small>alignRunEpisodes, then runEpisodes, flattened to distinct numbers</small>")] -.->|"listed: what the page would draw"| A["overLength(cluster, listed)"]
  A --> R["runLength(cluster)<br/><small>tieredConsensus over every member's episodeCount and score</small>"]
  R --> B{"do the best-scored sources agree on a length?<br/><small>length == null</small>"}
  B -->|"no member publishes an episodeCount: nothing to be wrong about"| N1["return []"]
  B -->|"a length came back"| C{"did the caller count what the page draws?<br/><small>listed == null</small>"}
  C -->|"no count passed: this rule is pure and will not walk the episode graph itself"| N2["return []"]
  C -->|"a number arrived"| D{"does it list more numbers than that length?<br/><small>listed &lt;= length</small>"}
  D -->|"11 distinct numbers against a length of 11, or fewer"| N3["return []"]
  D -->|"24 distinct numbers against a length of 11"| OUT["push lists more episodes than it is long<br/><small>24 episodes listed against a length of 11 that 3 of its sources agree on</small>"]
  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4
  class IN,R view
  class N1,N2,N3 refuse
```

*Both blue nodes are recomputed on every read and persist nothing, so this rule audits a view, not the store. Nothing on this path writes.*

The three refusals are one expression at `anomalies.ts:61`:

```ts
if (length == null || listed == null || listed <= length) return []
```

and the detail line at `:64-65` recounts the witnesses rather than trusting the reader to:

```ts
detail: `${listed} episodes listed against a length of ${length} that ${
  cluster.filter(media => media.episodeCount === length).length} of its sources agree on`,
```

That `filter` is the same set `runEpisodes` calls `backing` (`src/worker/store/consensus.ts:171`), so
a finding tells you at a glance whether the length it is complaining about rests on three sources or on
one.

### It closes a loop over the two previous pages

`listed` is whatever the caller counted. In the only caller it is
`tests/unit/worker/store/merge-fixtures.test.ts:89-97`:

```ts
/** How many distinct episode numbers the cluster holding `uri` lists, the way the page renders them. */
const listedEpisodes = async (uri: string): Promise<number> => {
  const cluster = await findAggregatedMedia(uri)
  const groups = await findRunEpisodes(cluster)
  const numbers = new Set<number>()
  for (const group of groups) {
    for (const episode of group) if (episode.episodeNumber != null) numbers.add(episode.episodeNumber)
  }
  return numbers.size
}
```

`findRunEpisodes` (`src/worker/store/db.ts:424-430`) is alignment then windowing: it calls
`alignRunEpisodes` over the flattened list and then `runEpisodes` per group. So the number this rule
tests is the number a reader would count on the page after both of those ran, which makes `overLength`
an audit of their combined output rather than of the store. If alignment moves Crunchyroll's 13 to 20
down onto 1 to 8 and windowing drops a fold's tail, the distinct-number count falls and the rule goes
quiet. If either declines, it does not.

### The bar the two functions do not share

`runLength` (`src/worker/store/consensus.ts:62-63`) is `tieredConsensus` with the tier thrown away.
It has no two-witness bar: one source publishing a count is enough for it to answer. The bar lives one
level up, in `runEpisodes` (`src/worker/store/consensus.ts:234`):

```ts
if (backing.length < 2) return episodes.filter(episode => members.has(episode.origin))
```

Read the two together and the interaction is plain. A length only one member claims is still a length
as far as `overLength` is concerned, while `runEpisodes` declines every window on exactly that
evidence and hands each member origin back its whole list untouched. So a cluster whose length rests
on a single witness can list more than that length and be reported for it, with the windowing that
would have acted on it having deliberately stood down. The `detail` string is what tells the two apart:
*a length of 13 that 1 of its sources agree on* is a different situation from *a length of 11 that 3 of
its sources agree on*, and only the second is a straightforward fold.

## What each rule costs to run

Neither touches the store, neither awaits anything, and neither mutates its input. `disagreeingIds`
reads `origin` and `id` off each member; `overLength` reads `episodeCount` and `score`, and takes the
episode count as an argument precisely so that it does not have to walk the episode graph. That purity
is the whole reason they can be swept: the sweep runs them over every distinct cluster of all thirteen
fixture cases on every suite run, and the cost of a call is a map and two filters.
