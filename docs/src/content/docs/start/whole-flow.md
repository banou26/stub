---
title: The whole flow, in full
description: One map of stub's data flow, from a uri in the address bar to a permanent union in the store, and every decision taken on the way.
---

stub is handed a uri and has to answer two questions with it: what is this thing, and where can you
watch it. No single catalogue answers both, so it asks 25 of them at once and merges what comes back.
This page is the map of that. Every other page on the site zooms one box on it.

## Five sentences, before anything else

1. **Every registered source is asked, unconditionally.** `joinFanout` (`src/worker/extractor.ts:746`)
   has no origin test, no uri inspection and no `supportedUris` check. All 25 built-in modules
   (`tests/unit/sources/index.test.ts:24` pins the count) plus any connected plugin get the app's own
   document, replayed verbatim against their own private GraphQL server.
2. **A source recognises itself by finding its own handle in the uri it was handed.** That is the
   whole of self-selection, and it is why a source can answer "not mine" and be right at the time and
   wrong a second later.
3. **Nothing comes back the way it went.** A source writes to the store through an envelop hook on
   its own resolver's return value; the app-level resolver ignores the fan-out's return values
   entirely and re-reads the store on a `media:changed` event. The answer path is a side channel.
4. **A handle is an identity claim.** A `SAME_AS` handle between two media of the same scope becomes
   a union-find union, and a union-find union has no inverse.
5. **stub models a RUN and catalogues model a SHOW.** A run is a cour or a film, the thing a card
   shows and the thing episodes belong to. Most of the machinery below is the exchange rate between
   those two.

:::danger
**One operation in this system cannot be undone.** `graph.link` is a union-find union, and
`createUnionFind` exposes no split, no unlink, no disunion. Once two media are welded they stay
welded for the life of the worker: the only reset is `resetStore()`, which empties the whole store
and is tests only. Everything else on this page exists to keep the wrong pair away from that one
call.
:::

The union is `union()` at `src/worker/store/graph.ts:81-104`, and the line that makes it permanent is
`components.delete(oldRoot)` at `:103`: after it, nothing can ask which members came from which side.
`resetStore` is `src/worker/store/db.ts:509-513`, and its own comment on `graph.clear` reads *Tests
only*.

## The map, in four figures

Drawn as one figure this is 48 nodes, and rendered it measures 6,500px wide, where every label shrinks
past reading. So it is cut at its real seams: the **ask** ends where a source mints a handle, the
**write** ends where the store emits, and the **read** starts there and comes back around. The four
share one node vocabulary and the same four colours, and the conditions on the decision nodes are
verbatim from the files cited beside each figure.

### 1a. The ask: the page and the worker

```mermaid
flowchart TD
  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4

  subgraph PAGE["1 - the page"]
    P1["route param, then decodeRouteUri<br/>ag:(anilist:166873)"]
    D1{"names a uri?<br/><small>!requestedUri ||<br/>!(isUri(requestedUri)<br/>|| isAggregatedUri(requestedUri))</small>"}
    P2["console.warn, the generator<br/>returns with no yield: 204,<br/>and the page sits empty"]
    P4["a listing: no uri,<br/>so nothing to gate"]
  end

  subgraph WORKER["2 - the worker"]
    W1["Subscription.media"]
    W2["Subscription.mediaPage"]
    W3["proxyRequestToExtractors<br/>openRoot mints a token,<br/>stamped into the variables"]
    D2{"crossSource?<br/><small>POLICY[context.operation]<br/>?? UNKNOWN_POLICY</small>"}
    W5["a listing: no similarMedia ask,<br/>and JustWatch's offer keeps its<br/>url, losing the identity claim"]
    W6["a detail view: a source may<br/>spend a cross-source request,<br/>and resolveSimilarRuns may ask"]
    W7["the fan-out, figure 1b"]
  end

  P1 --> D1
  D1 -->|"refused: no source asked"| P2
  D1 -->|"a uri, or aggregated"| W1
  P4 --> W2
  W1 --> W3
  W2 --> W3
  W3 --> D2
  D2 -->|"MEDIA_PAGE: false"| W5
  D2 -->|"MEDIA: true"| W6
  W3 --> W7

  class P2,W5 refuse
```

*The gate at the top is the only one that can end the whole request: it returns without yielding, and not one source is asked.*

### 1b. The fan-out, and one source

```mermaid
flowchart TD
  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4

  subgraph FAN["3 - the fan-out"]
    F1["joinFanout: every registered<br/>source, unconditionally.<br/>25 built-in plus any plugin,<br/>one private yoga each"]
    F3["askOrigins: the re-ask"]
    D3{"answersForOrigins?<br/><small>origins.includes(source.origin)<br/>|| (source.supportedUris ?? [])<br/>.some(origin =&gt;<br/>origins.includes(origin))</small>"}
    F4["continue: not re-asked"]
  end

  subgraph SRC["4 - one source, and all 25 do this"]
    S1["Subscription.media,<br/>in the source's own yoga"]
    D4{"is this mine?<br/><small>extractAggregatedUriOrigin(<br/>_uri, origin)</small>"}
    S2["getMedia(uri.id, ctx)"]
    D4b{"aggregated at all?<br/><small>!isAggregatedUri(_uri)</small>"}
    S3["yield { media: null }<br/>the fan-out lives,<br/>nothing is written"]
    S4["searchAndLinkMedia(_uri, ctx)"]
    D5{"title and date both agree?<br/><small>entry.score &gt;=<br/>CONFIDENT_TITLE_THRESHOLD,<br/>then !nearest || nearest.diff<br/>&gt; SEASON_DATE_WINDOW</small>"}
    S5["sameAs(node):<br/>names THIS run"]
    S6["partOf(node):<br/>a copy scoped CONTAINER"]
  end

  F1 --> S1
  F3 --> D3
  D3 -->|"named by the wider uri"| S1
  D3 -->|"no origin it declares"| F4
  S1 --> D4
  D4 -->|"a cr: handle is in it"| S2
  D4 -->|"no cr: in the uri"| D4b
  D4b -->|"a bare foreign uri"| S3
  D4b -->|"aggregated"| S4
  S4 --> D5
  D5 -->|"refused, nothing minted"| S3
  D5 -->|"both axes clear"| S5
  S2 --> S5
  S2 --> S6
  S5 -.->|"figure 3 comes back here"| F3

  class S3,F4 refuse
  class S5 irrev
  class S6 ratchet
```

*Two refusals here produce an identical empty page from different places: a source yielding null is a normal payload the fan-out continues past, where the gate in figure 1a ends the generator outright.*

The uri gate is `src/worker/resolvers/media/index.ts:33-38`. It returns without yielding, and a
generator that completes without yielding makes yoga answer 204, so the page sits at
`data === undefined` forever. That is why the warning next to it exists:

> `src/worker/resolvers/media/index.ts:35`
>
> a refused page and a slow one are indistinguishable from outside the worker without this

The two gate constants are real and are on the figure: `CONFIDENT_TITLE_THRESHOLD = 0.9`
(`src/sources/catalogue-gate.ts:98`) and `SEASON_DATE_WINDOW = 45 * 24 * 60 * 60 * 1000`
(`:230`), with at most `MAX_CATALOGUE_CANDIDATES = 3` survivors date-checked (`:109`). The whole gate
refuses before it starts when there is no date at all, `if (!known.startDate) return undefined`
(`:286`), because a gate on one axis is measurably not a gate.

The re-ask lane (`askOrigins`, `src/worker/extractor.ts:825`) is entered from the read, not from the
page. The reason is the best paragraph in the resolver:

> `src/worker/resolvers/media/index.ts:43-48`
>
> The uri the sources were asked about is the one the caller had at subscribe time, and a card
> on the home page links to a narrow one: the listing builds its media without running the
> mappers that mint a `cr:` handle (sources/anilist/extractor.ts:320 against :295). A source
> can only recognise itself by finding its own handle in the uri it is handed, so every source
> missing from that narrow uri answered "not mine" and ENDED, milliseconds before another
> source contributed its id.

The two mint nodes are the whole point of the ask, and they are two different promises:

> `src/sources/utils.ts:24-25`
>
> This handle names THIS run. Unions the cluster, permanently, with no inverse. The default, and the
> only relation any producer asserted before 2026-09-04.

> `src/sources/utils.ts:36-38`
>
> THIS IS THE SCOPE STAMP. A PART_OF target is by definition a container of this run, so the node goes
> out as a copy scoped CONTAINER whatever it said, and the store then keeps it out of every run's
> identity space for good (scope is sticky toward CONTAINER there). The input is left untouched.

### 2. The write

```mermaid
flowchart TD
  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4

  subgraph HOOK["1 - the hook, in every source's yoga"]
    A1["a source resolver<br/>returns a value"]
    D6{"named type of the field?<br/><small>getNamedType(<br/>info.returnType).name</small>"}
    A2["mediaInserter<br/>250 rows, 50 ms, cache: false"]
    A3["episodeInserter<br/>250, 50 ms, no dedupe,<br/>no unwrap"]
    A4["originInserter<br/>maxBatchSize 50"]
    A5["an unselected field is a<br/>resolver that never ran, so its<br/>type never fires an inserter"]
  end

  subgraph UP["2 - upsertMedia(rows, claims)"]
    B1["recursivelyUnwrapMediaHandles<br/>the walk stops at a PART_OF node"]
    D7a{"is the row a placeholder?<br/><small>media.scope !== 'CONTAINER'<br/>&& every field is in<br/>IDENTITY_FIELDS, null or []</small>"}
    B2["skipped: a uri says nothing<br/>about what it names"]
    B3["graph.set(uri, row)<br/>CONTAINER once is<br/>CONTAINER for good"]
    D7b{"does each end have a row?<br/><small>[mediaUri, handleUri].filter(<br/>uri =&gt; !graph.has(uri))</small>"}
    B4["defer under each missing end.<br/>pendingClaims: no expiry,<br/>applied when the row lands"]
    D7{"same scope?<br/><small>mediaScope !== handleScope</small>"}
    B5["graph.link: a union-find<br/>union, and no inverse"]
    B6["graph.edge: run to<br/>container, deletable"]
    B7["emit('media:changed')"]
  end

  A1 --> D6
  D6 -->|"Media"| A2
  D6 -->|"Episode"| A3
  D6 -->|"Origin"| A4
  D6 -->|"anything else"| A5
  A2 --> B1
  B1 --> D7a
  D7a -->|"identity fields only"| B2
  D7a -->|"it describes something"| B3
  B3 --> D7b
  D7b -->|"one end has no row"| B4
  D7b -->|"both describe themselves"| D7
  D7 -->|"cross-scope, whatever<br/>was claimed"| B6
  D7 -->|"same scope,<br/>claimed SAME_AS"| B5
  D7 -->|"same scope,<br/>claimed PART_OF"| B6
  B5 -->|"changed = true"| B7
  B6 -->|"only a first<br/>MEDIA_PART_OF edge"| B7

  class B2,A5 refuse
  class B5 irrev
  class B3 ratchet
```

*The claimed relation is only consulted in the same-scope cells. Cross-scope, both directions, the store writes an edge and ignores what the source asked for.*

`useOnResolve` (`src/worker/extractor.ts:473-495`) fires on a resolver's **return value**, keyed on
that field's named type, which is why a row lands whole even where a field is not selected, and why
an unselected `episodes` means `episodeInserter` never fires at all. The 2x2 the store derives is
written out in the code above the loop, `src/worker/store/db.ts:166-169`, and the union is
`graph.link` at `db.ts:193`.

The subtree cut at `src/worker/store/aggregate.ts:135` is the one guard on this figure whose absence
has a name:

> `src/worker/store/aggregate.ts:115-124`
>
> THE WALK STOPS AT A PART_OF NODE, and that is the load bearing part. A PART_OF node is a CONTAINER,
> usually a show, and its own handles are claims about the CONTAINER rather than about the run that
> pointed at it. Carrying them through means two different runs, each hanging PART_OF off the same
> show, each contribute a SAME_AS pair rooted at that show:
>
>     season 1 -PART_OF-> cr:SERIES -SAME_AS-> kitsu:42323
>     season 3 -PART_OF-> cr:SERIES -SAME_AS-> kitsu:49002
>
> and `cr:SERIES` is one uri, so the union-find puts kitsu:42323 and kitsu:49002 in one cluster. Two
> seasons welded, with no inverse, by a relation whose entire purpose is not to weld.

:::caution
**Scope is sticky toward CONTAINER.** Once any row for a uri said CONTAINER, a later row saying RUN
or saying nothing does not flip it back (`src/worker/store/db.ts:146`). The argument is at
`db.ts:142-145`: *the failure with no inverse is a wrong SAME_AS, and the failure of a wrong
CONTAINER is a missing SAME_AS, which a later slice can recover.* Note the last sentence of that
comment, which is the reason the line exists at all: *the merge function alone would let an incoming
RUN overwrite it (scalars are last-write-wins).*
:::

### 3. The read, and the loop

```mermaid
flowchart TD
  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4

  subgraph EV["1 - the event"]
    E1["emit('media:changed')"]
    E2["listenMultipleIterator<br/>undebounced on a media page,<br/>100 ms on a listing"]
    E3["fuzzyMergeMediaClusters,<br/>on the mediaPage read only"]
  end

  subgraph RD["2 - read(), once per event"]
    C1["findMediaForPage(requestedUri)"]
    D8a{"did anything answer?<br/><small>if (!cluster.length)<br/>return undefined</small>"}
    C2["no yield: the page keeps<br/>the frame it had"]
    C3["preferAttachedRun"]
    C4["aggregateMedia(cluster,<br/>location.origin)"]
    C5["askUnasked(media.uri):<br/>back to askOrigins, figure 1"]
  end

  subgraph EP["3 - Media.episodes, a second read"]
    C6["findRunEpisodes(cluster)"]
    C7["alignRunEpisodes: a Map of<br/>copies, never a renumber"]
    D8{"corroborated length?<br/><small>backing.length &lt; 2</small>"}
    C8["refuse the loan whole: keep<br/>only origins holding a row<br/>in this cluster"]
    C9["window 1..length,<br/>foreign origins only"]
    C10["the page renders"]
  end

  E1 ==>|"sources write, the page re-reads"| E2
  E2 --> C1
  E2 -.->|"a listing read that writes"| E3
  E3 -.->|"graph.link, then read again"| C1
  C1 --> D8a
  D8a -->|"nothing names this uri yet"| C2
  D8a -->|"a cluster"| C3
  C3 --> C4
  C4 --> C5
  C4 --> C6
  C6 --> C7
  C7 --> D8
  D8 -->|"one witness only"| C8
  D8 -->|"two or more members"| C9
  C8 --> C10
  C9 --> C10

  class C2 refuse
  class C3,C4,C7,C8,C9 view
  class E3 irrev
```

*The thick edge is the one that carries the design: every other arrow on these four figures points into the store, and this is the only one out of it and back around. The dashed edges cross the read/write line, which is the site's convention for a read that writes.*

Everything blue on this figure is recomputed on every event and stored nowhere.
`alignRunEpisodes` says so itself:

> `src/worker/store/consensus.ts:247-250`
>
> READ TIME, AND A COPY. The stored node keeps Crunchyroll's own number, because it is keyed by
> Crunchyroll's guid and is reachable through the whole season from other paths: `graph.set` is
> last-write-wins, so rewriting it here would change what those other readers see. What the run needs
> is a VIEW, and a view is what this returns.

The `backing.length < 2` branch is `src/worker/store/consensus.ts:234`, inside `runEpisodes` at
`:157`. It is the only decision on the figure that hides a row, and it refuses rather than trims when
only one member vouches for the length:

> `src/worker/store/consensus.ts:227-232`
>
> AN UNCORROBORATED LENGTH REFUSES THE LOAN OUTRIGHT rather than slicing on it.
>
> A lent season is only useful if the run can say which of its episodes are its own, and a length
> one source claims cannot. Mushoku Tensei season 2 part 1 is the case: MAL publishes no count at
> all and AniList says 13 for a run that aired 12, so windowing to 13 put a thirteenth row on the
> page that only Crunchyroll had. Declining leaves the page exactly as it was.

## The permanence legend

Four colours, and they carry permanence and nothing else. Every flowchart on this site uses these
four `classDef` names for these four meanings.

```mermaid
flowchart LR
  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4

  L1["graph.link<br/><small>a union-find union. No split, no unlink, no disunion.</small>"]
  L2["RUN becomes CONTAINER<br/><small>the scope ratchet: one way, and no later row flips it back</small>"]
  L3["graph.edge, graph.set<br/><small>an edge is deletable; a set is last write wins, longest array kept</small>"]
  L4["aggregateMedia, alignRunEpisodes, runEpisodes<br/><small>computed per read: a view, written nowhere</small>"]

  class L1 irrev
  class L2 ratchet
  class L3 refuse
  class L4 view
```

*This is the one figure on the site with no decision node, and deliberately: it is the key every other figure is read with.*

## The three questions the system asks, and who answers each

Every claim that reaches `graph.link` has answered all three, and each one is answered by a different
part of the system. The lane below is the `similarMedia` path, which is where all three are visible
at once.

```mermaid
flowchart TD
  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4

  subgraph QA["WHICH SHOW: the PART_OF edge the caller already holds"]
    T1["the run's PART_OF targets<br/>findPartOfMedia(cluster)"]
    T2["a show id, off a container<br/>cluster the fuzzy title pass<br/>may have unioned"]
  end

  subgraph QB["WHICH RUN of it: the source, through pickSimilarSeason"]
    T3["the source lists that show's<br/>seasons and picks one"]
    T4{"a run, and never the show?<br/><small>answer.origin === origin<br/>&& answer.scope !== 'CONTAINER'<br/>&& answer.id !== showId</small>"}
    T5["refused: that id is<br/>every season at once"]
    T6{"does it name our show?<br/><small>score &gt;= SHOW_TITLE_THRESHOLD,<br/>where SHOW_TITLE_THRESHOLD = 0.9</small>"}
    T7["refused-by-title: the ask<br/>re-runs on a new title"]
  end

  subgraph QC["IS IT THE SAME THING: the store, through the scope pair"]
    T8["upsertMedia([], [SAME_AS claim])"]
    T9{"same scope?<br/><small>mediaScope !== handleScope</small>"}
    T10["graph.link in the run space"]
    T11["graph.edge: run to container"]
  end

  T1 --> T2
  T2 --> T3
  T3 --> T4
  T4 -->|"a run of that show"| T6
  T4 -->|"the bare show id"| T5
  T6 -->|"the titles agree"| T8
  T6 -->|"best pair under 0.9"| T7
  T8 --> T9
  T9 -->|"RUN x RUN, SAME_AS"| T10
  T9 -->|"it came back CONTAINER"| T11

  class T5,T7 refuse
  class T10 irrev
```

*Three separate answers, three separate places they can be wrong, and only the third one is irreversible. The first is inherited: nothing in this lane re-checks it.*

The lane's own module says which question it is and is not answering:

> `src/sources/similar.ts:10-12`
>
> The rules decide WHICH season of a show and never WHICH show: the show id the caller holds settles
> that, and it came off a PART_OF edge whose container cluster the fuzzy title pass may have unioned
> on a listing. A wrong container union upstream is trusted here, so a pick is only as right as it.

And the claim it produces is an ordinary one, which is what makes the figure's third lane the same
lane as figure 2's:

> `src/worker/similar-consumer.ts:271-277`
>
> Only a root whose policy spends cross-source work asks (a listing never does). A read with no
> evidence records nothing, and a read whose run has no title asks nothing, since an answer could not
> be checked against the show. The claim goes through `upsertMedia` with no rows: the answer's own
> row lands through the answering extractor's insertion, the claim waits for it under
> `pendingClaims`, and a RUN x RUN union emits `media:changed`, which re-runs the page's read, whose
> re-ask of the newly named origin is how the answer's episodes reach the store. The container edge is
> never touched.

The run check is `isRunAnswerFrom` at `src/sources/similar.ts:125-129`, the title check is
`answerNamesOurShow` at `:310-320` against `SHOW_TITLE_THRESHOLD = 0.9` (`:303`), and the scope pair
is `db.ts:187`. The threshold has a measurement behind it, not a taste: *correct pairs 1.000, the
nearest wrong pair 0.8135, a spin-off* (`similar.ts:300-301`).

## Deliberately not on these figures

The omissions are chosen, not missed. Each has its own page:

- plugin registration and the reduced contract a third-party source runs under: [Plugin sources](/request/plugins/)
- `withBackoff`, the retryable status set and both spellings of `retry-after`: [Fetching, and backing off](/request/fetch-and-backoff/)
- the request-context registry, why the token rides in the variables, and the miss counter: [The request context](/request/request-context/)
- `pendingClaims`, and the race that put it there: [Claims that wait](/write/pending-claims/)
- `exportStore`, which reads the asserted adjacency and never the unions: [Exporting](/read/export/)
- the origin fan-out, which is a second loop that stamps nothing: [The fan-out](/request/fan-out/)
- the five gates of the fuzzy title merge: [The five gates](/merge/gates/)
- the five rules of `pickSimilarSeason`: [The rules](/similar/rules/)
- the alignment offset vote and its three refusals: [Aligning a numbering](/merge/alignment/)

## Where the code disagreed with the plan for this page

Two corrections, both already applied to the figures above.

**`graph.set` is not append only.** The legend node calls it last write wins, because that is what
the merge does: `lastWriteLongestArray` (`src/worker/store/graph.ts:388-400`) writes
`result[key] = val ?? existing[key]` for a scalar, and for an array keeps whichever of the two is
longer, discarding the shorter one whole. No provenance is kept either way, so nothing downstream
can ask what a given origin said. Only `graph.edge` is append only.

**The scope decision has three outcomes, not two.** The plan drew the 2x2 as one decision with two
edges, a union on one side and an edge on the other. The loop at `src/worker/store/db.ts:187-198`
has three: cross-scope writes an edge whatever was claimed, same-scope plus `SAME_AS` links, and
same-scope plus `PART_OF` writes an edge too. The third is drawn, because a claim that says PART_OF
between two runs is the one case where a source's own word is what keeps it off the union.
