---
title: Plugin sources
description: A third-party source is an ordinary source with a reduced contract. Four places enforce the reduction, and one deliberate exemption lets a plugin's handles reach graph.link anyway.
---

A plugin is a source that arrives at runtime over a `MessagePort` instead of at build time as a module
namespace. After registration it is indistinguishable from a built-in almost everywhere: it sits in the
same `extractors` array (`src/worker/extractor.ts:551`, pushed at `:683`), gets its own private yoga
built by the same `makeExtractor`, is joined to the fan-out by the same `joinFanout`, and writes to the
store through the same `useOnResolve` hook and the same three DataLoaders
(`src/worker/extractor.ts:473-495`). Twenty-five built-ins are compiled in
(`tests/unit/sources/index.test.ts:24`); a plugin makes it twenty-six, and nothing downstream counts.

What is reduced is the contract, in four places and no others:

1. **its identity** must be a short lowercase token that no registered source already holds;
2. **its context** is one function, not the five a built-in gets;
3. **its top-level answers** must carry its own origin, checked on every yielded payload;
4. **its rows are force-excluded from an export**, worker-side, whatever the caller asked for.

Everything else about it is a first-class source, and that is the point. The exemption in the middle of
the third rule is what this page exists to make visible.

## Connect, register, join

The main thread owns the connection and the worker owns the registry. `src/plugins.ts` persists the
enabled list in `localStorage` under `'stub-enabled-plugins'` (`:8`) and connects each entry at module
scope (`:149-151`); the worker never learns a package exists until a port is handed to it.

```mermaid
sequenceDiagram
  autonumber
  participant P as page, src/plugins.ts
  participant K as FKN packages
  participant FR as the package frame
  participant W as worker registry, extractor.ts
  participant F as every in-flight fan-out

  P->>P: connectPlugin uri, attempt 1. connected.add uri BEFORE the attempt succeeds
  P->>K: packages.connect uri, protocol stub-source@1, raw true
  alt no port inside CONNECT_TIMEOUT_MS = 45_000
    K--xP: rejected, connecting to uri timed out
    P->>P: connected.delete uri, setStatus error, scheduleReconnect uri, attempt + 1
  end
  K-->>P: port and closed
  P->>P: closed.then teardown wired BEFORE the handshake
  P->>W: registerRemoteSource port, uri, the values kept for uri
  W->>FR: attach port
  FR-->>W: data fields materialize locally, resolver functions stay remote in the frame
  W->>W: readPluginSources remote, pluginUri
  W->>W: unregisterRemoteExtractor pluginUri, BEFORE the collision check
  opt the package serves configure
    W->>FR: configure values, waited for CONFIGURE_WAIT_MS = 3_000 at most, BEFORE any source joins
    alt unregistered during the wait
      W-->>P: error, left while connecting
    end
  end
  loop each source readPluginSources accepted
    alt extractors already hold this origin
      W->>W: throw, failed.push origin and reason, siblings carry on
    else the origin is free
      W->>W: makeExtractor meta plus makeDelegatingResolvers, entry.pluginUri = uri
      W->>F: joinFanout fanout, entry, for every fan-out still open
    end
  end
  alt registered.length is 0
    W-->>P: error, no source could be registered
    P->>P: setStatus error, scheduleReconnect uri, attempt + 1
  else at least one source registered
    W-->>P: ok, sources, rejected and settings
    P->>P: setStatus connected, both lists on screen, a form for the settings
  end
```

*A connection that produced one working source and three rejections is a success, not a partial
failure: the page shows both lists and the three do not come back until the package is reconnected.*

**The teardown is wired before the handshake, and the ordering is load bearing.** `src/plugins.ts:90`:

> wire teardown BEFORE the worker handshake: a frame death mid-registration must still recover

If `closed.then(...)` were attached after `registerRemoteSource` resolved, a frame that died during
`attach` would leave `connected` holding the uri with nothing to clear it, and `scheduleReconnect`
refuses to run while `connected.has(uri)` (`:69`). The same reasoning drives the deadline.
`src/plugins.ts:85`:

> `connected` is claimed before the attempt succeeds, so an attempt that never settles holds the slot forever

`CONNECT_TIMEOUT_MS = 45_000` (`src/plugins.ts:56`) is applied twice: once to `packages.connect` and
once to the registration race, which also races `closed` so a package that dies mid-registration
resolves as `{ error: 'the package closed before the source registered' }` (`:96-99`) rather than
waiting out the deadline.

**Two reconnect paths, two different first delays.** `scheduleReconnect(uri, attempt)` computes
`Math.min(RECONNECT_DELAY_MS * attempt, RECONNECT_MAX_MS)` (`src/plugins.ts:72`) with
`RECONNECT_DELAY_MS = 3_000` (`:9`) and `RECONNECT_MAX_MS = 30_000` (`:66`). A frame death calls it with
`1`, so the retry is 3 seconds out. A registration failure calls it with `attempt + 1` from
`connectPlugin`'s catch (`:108`), so the first retry there is 6 seconds out, then 12, 18, 24, and 30
from then on. That asymmetry is not decoration: `src/plugins.ts:107` records why the catch schedules at
all.

> registration errors leave the frame alive, so `closed` never fires: the reconnect comes from here

**The enabled list is written only after the install took**, and it is keyed on the id FKN hands back.
`src/plugins.ts:118-119`:

> install through FKN first and only persist to the enabled list once it took: FKN refuses to connect a package this app has not installed, so a mistyped address written straight to the list is retried forever
>
> key everything on the id FKN hands back, never the caller's string: FKN canonicalizes a version away ('npm:x@1.2.3' installs as 'npm:x')

## `readPluginSources`: a malformed source costs only itself

One connection may carry a family of sources, because a package that indexes two trackers is two
sources that happen to share a frame. `src/worker/plugin-sources.ts:44-83` validates each on its own.

```mermaid
flowchart TD
  IN["the attached payload, plus the pluginUri it arrived on"]
  D0{"does the payload declare a family?<br/><small>Array.isArray(payload.sources) &amp;&amp; payload.sources.length</small>"}
  FAM["incoming = payload.sources"]
  SOLO["incoming = [payload]<br/><small>the single-source shape every plugin written before this sends</small>"]
  LOOP["for (const source of incoming)"]
  D1{"is the origin a short lowercase token?<br/><small>!PLUGIN_ORIGIN_TOKEN.test(origin)</small>"}
  R1["rejected.push origin or '(none)', 'origin must be a short lowercase token'<br/>continue"]
  D2{"has this payload already claimed it?<br/><small>claimed.has(origin)</small>"}
  R2["rejected.push origin, declared twice by pluginUri<br/>continue"]
  META["meta built with coercions: originUrl to '', name = source.name.slice(0, 64) or the origin,<br/>icon and color to null, isApiOnly and metadataOnly by === true, access to 'none' unless 'account' or 'paid'"]
  D3{"is the origin already registered by another source?<br/><small>extractors.some(entry =&gt; entry.extractor.origin === meta.origin)</small>"}
  R3["throw inside the per-source try, failed.push, siblings carry on"]
  OK["extractors.push entry, entry.pluginUri = uri, joinFanout every open fan-out"]
  D4{"did anything survive?<br/><small>if (!registered.length) throw</small>"}
  FAIL["the whole connection is an error<br/>the page records it and schedules a reconnect"]
  DONE["connected, with sources and rejected both reported"]

  IN --> D0
  D0 -->|"a sources list with at least one entry"| FAM
  D0 -->|"no list, or an empty one: fall back to the payload itself"| SOLO
  FAM --> LOOP
  SOLO --> LOOP
  LOOP --> D1
  D1 -->|"'BAD ORIGIN', '', or a non-string: rejected, this source only"| R1
  D1 -->|"matches /^[a-z0-9][a-z0-9-]{0,31}$/"| D2
  D2 -->|"a repeat inside one payload: the FIRST is kept"| R2
  D2 -->|"first time in this payload"| META
  META --> D3
  D3 -->|"a built-in or another plugin holds it"| R3
  D3 -->|"free"| OK
  R1 --> D4
  R2 --> D4
  R3 --> D4
  OK --> D4
  D4 -->|"every declared source was rejected"| FAIL
  D4 -->|"at least one registered"| DONE

  classDef irrev fill:#fbeae7,stroke:#b03f33,color:#3a1512
  classDef ratchet fill:#faf1e0,stroke:#8f5a0e,color:#3a2a08
  classDef view fill:#e9eef7,stroke:#4572b5,color:#16283f
  classDef refuse fill:#f0f0f2,stroke:#7b7d85,color:#33343a
  class R1,R2,R3,FAIL refuse
```

*Three of the four refusals here are per-source and one is per-connection, and the difference is the
whole design: a package is only a shipping container.*

The figure spans two functions. Everything down to `META` is `readPluginSources`, which is pure and has
no idea what else is registered; the collision check and the empty-result throw are
`registerRemoteExtractor` (`src/worker/extractor.ts:735-737` and `:758-761`), which is the only half
that can see the rest of the registry. They are drawn together because a plugin author experiences them
as one list of reasons a source did not appear.

`src/worker/plugin-sources.ts:31-43` states the rule the figure draws:

> A payload is either ONE source, or a `sources` list so a single package can ship a family of them
> (an indexer package serving animetosho and nyaa, say). The single shape stays supported because it
> is what the example plugin and every plugin written before this sends.
>
> A source in a family is an ordinary standalone source that happens to arrive over a shared
> connection. So a malformed one is REPORTED and skipped, never fatal to its siblings: the same rule
> the fan-out follows for a failing extractor and the source layer follows for a bad record. Dropping
> the whole family because one entry is wrong would make a package strictly more fragile than the
> same sources shipped separately, which is backwards.

The constants, exactly as written:

| thing | value | where |
| --- | --- | --- |
| `PLUGIN_ORIGIN_TOKEN` | `/^[a-z0-9][a-z0-9-]{0,31}$/` | `src/worker/plugin-sources.ts:6` |
| name cap | `source.name.slice(0, 64)`, falling back to the origin | `src/worker/plugin-sources.ts:73` |
| protocol | `'stub-source@1'` | `src/plugin-api.ts:59` |
| media handle depth | `4` | `src/worker/plugin-sources.ts:123` |
| episode handle depth | `1` | `src/worker/plugin-sources.ts:126` |

The origin regex allows 1 to 32 characters. Its comment (`src/worker/plugin-sources.ts:5`) says why it
is that narrow:

> A short lowercase token. Origins name things across the store, the UI and the uri grammar.

An origin is a uri prefix, so `nyaa:1234` has to survive `originOf`, a route segment, and the
aggregated-uri grammar. A token with a colon or a comma in it would be a uri that does not parse; see
[the uri grammar](/invariants/uris/).

**The unregister runs before the collision check.** `src/worker/extractor.ts:671-672`:

> a reconnect re-registers the same plugin, so drop its own previous entries before the collision check

Without it, a package reconnecting after a frame death would collide with itself on every origin it
already held, and the reconnect that exists to recover the source would be the thing that permanently
refuses it.

The per-source isolation is pinned. `tests/unit/worker/plugin-sources.test.ts:33-40` feeds
`['good', 'BAD ORIGIN', 'alsogood']` and asserts the surviving origins are `['good', 'alsogood']` with
exactly one rejection; `:78-82` asserts a 200-character name comes back at length 64.

## One payload, out of the frame and into the store

A plugin's resolvers do not run in the worker. `attach` materializes the data fields locally and leaves
the functions remote (`src/worker/extractor.ts:553`), so `makeDelegatingResolvers`
(`src/worker/extractor.ts:601-635`) wraps each declared `subscribe` in a local generator that awaits the
remote one and rewrites what comes back before yielding it onward.

```mermaid
flowchart TD
  Y["the plugin's subscribe generator yields a payload,<br/>inside the package's own frame"]
  RP["readPluginPayload(field, payload)"]
  D1{"which field is this?<br/><small>field === 'mediaPage'</small>"}
  PG["every node in mediaPage.nodes through readPluginHandles"]
  ME["payload[field] through readPluginHandles"]
  D4{"is there a level of handles left?<br/><small>Array.isArray(handles) &amp;&amp; depth &gt; 0</small>"}
  EMPTY["handles: []<br/><small>media bottoms out at depth 4, an episode's handles at depth 1</small>"]
  D2{"is this handle already an edge?<br/><small>isObject(handle) &amp;&amp; 'node' in handle</small>"}
  D3{"can a bare value name a media?<br/><small>typeof value.uri === 'string', else origin and id both strings</small>"}
  DROP["dropped: an edge whose node is not an object,<br/>or a value that is neither row nor edge"]
  EDGE["kept as sent. relation stays unless it is not a string, then 'SAME_AS'"]
  ROW["{ node, relation: 'SAME_AS' }<br/>uri derived as origin:id when only the pair is there"]
  READ["the payload, every handle now an edge"]
  EO["enforcePluginOrigin(origin, field, payload)"]
  D5{"does the top-level media carry the plugin's own origin?<br/><small>payload[field] &amp;&amp; payload[field].origin !== origin</small>"}
  NULLED["console.warn, return { [field]: null }<br/>the whole answer is discarded"]
  D6{"mediaPage: does this node?<br/><small>node?.origin === origin</small>"}
  DROPN["console.warn per node, the node is filtered out"]
  PASS["yielded to this source's own yoga"]
  EXEMPT["nested handles are NOT checked at any depth"]
  STORE[("useOnResolve, mediaInserter, upsertMedia<br/>the identical path a built-in takes")]

  Y --> RP
  RP --> D1
  D1 -->|"mediaPage: node by node"| PG
  D1 -->|"media or similarMedia: the one media"| ME
  PG --> D4
  ME --> D4
  D4 -->|"depth exhausted, or handles is not an array"| EMPTY
  D4 -->|"a level remains, read at depth - 1"| D2
  D2 -->|"has a node key"| EDGE
  D2 -->|"has a node key but the node is not an object: the 2026-09-05 shape"| DROP
  D2 -->|"no node key: a bare row"| D3
  D3 -->|"it names a media"| ROW
  D3 -->|"null, a string, or an object naming nothing"| DROP
  EDGE --> READ
  ROW --> READ
  EMPTY --> READ
  READ --> EO
  EO --> D5
  EO -->|"handles nested inside the payload, at any depth"| EXEMPT
  D5 -->|"media or similarMedia from a foreign origin"| NULLED
  D5 -->|"media or similarMedia, its own origin"| PASS
  D5 -->|"field is mediaPage"| D6
  D6 -->|"node.origin !== origin"| DROPN
  D6 -->|"node.origin === origin"| PASS
  PASS --> STORE
  EXEMPT --> STORE

  classDef irrev fill:#fbeae7,stroke:#b03f33,color:#3a1512
  classDef ratchet fill:#faf1e0,stroke:#8f5a0e,color:#3a2a08
  classDef view fill:#e9eef7,stroke:#4572b5,color:#16283f
  classDef refuse fill:#f0f0f2,stroke:#7b7d85,color:#33343a
  class DROP,NULLED,DROPN,EMPTY refuse
  class STORE,EXEMPT irrev
```

*Two of the three arrows into the store are checked. The third, `EXEMPT`, is the one that carries
identity claims about other origins, and it is checked nowhere.*

### The handle shape, and the day it emptied a shared batch

`readPluginHandles` exists because the schema changed under plugins that were already deployed.
`src/worker/plugin-sources.ts:111-122`:

> `stub-source@1` plugins were written against `handles: [Media!]!`, a bare list of the rows a media is
> the same as, and every one of them still sends it: the nyaa package restates the cluster's handles as
> bare rows. The schema made a handle an edge, `{ node, relation }`, on 2026-09-04 and the worker read
> `handle.node` from then on, so a bare row was an edge with no node, the unwrap dereferenced it, and
> the shared insert batch rejected for every extractor in it, first-party sources included
> (2026-09-05, on the deployed site). A bare row reads as the SAME_AS it always meant; an edge passes
> through with its node read the same way; anything that is neither is dropped. Episodes' handles are
> read alike. The depth cap bounds a self-referencing payload.

Read that last-but-one sentence against the DataLoader it names. `mediaInserter` batches up to 250 rows
across every source in the same 50 ms window (`src/worker/extractor.ts:106-134`), so one plugin's
malformed handle threw inside a batch that also held Crunchyroll's and AniList's rows, and the whole
batch rejected. A third-party shape error took down first-party writes. That is the failure the depth
caps and the per-handle drop are here to make impossible: a handle that cannot be read is discarded
before it reaches the batch, not thrown from inside it.

The depth cap is per level of nesting, not per handle: `readPluginHandles(media, 4)` reads four levels
of media handles and empties the fifth, and an episode's handles are read at depth `1`, so an episode
handle's node carries no handles of its own. `tests/unit/worker/plugin-sources.test.ts:143-146` pins
the drop set exactly: `{ origin: 'anilist', id: '2' }` becomes a `SAME_AS` edge to `anilist:2`, while
`null`, `'junk'` and `{ relation: 'SAME_AS' }` all vanish.

### `enforcePluginOrigin`, and what it does not check

`src/worker/extractor.ts:580-599`. For `media` and `similarMedia` the check is on the answer itself, and
failing it discards the entire payload rather than repairing it:

```ts
if (payload?.[field] && payload[field].origin !== origin) {
  console.warn(`Plugin source '${origin}' yielded media from origin '${payload[field].origin}', dropped`)
  return { [field]: null }
}
```

`src/worker/extractor.ts:581-583` says why `similarMedia` is held to the same rule as `media`:

> similarMedia answers with one media, exactly as `media` does, so it is held to the same rule: a
> plugin may only ever name ITS OWN run. Without this a plugin asked about its own show could
> answer with someone else's uri and have it linked as an identity.

For `mediaPage` the filter is per node, so a page of ten results where three name a foreign origin
yields seven, with one warning each. The payload survives; only the offending nodes leave.

And then the exemption, `src/worker/extractor.ts:577`:

> nested handles stay untouched: cross-origin handles are how clustering works (accepted residual, bounded by the aggregation score threshold)

This is not an oversight, and it is not small. A plugin may not *be* AniList, but it may say
`nyaa:1234 SAME_AS anilist:166873`, and nothing on this path examines that claim. It has to be that
way: a handle naming another origin is the entire clustering mechanism, and a source that could only
name itself could never join anything. The residual is bounded downstream rather than here, by the
score threshold the fuzzy merge applies; see [the five gates](/merge/gates/).

:::danger[A plugin's handles reach `graph.link`, which has no inverse]
A plugin's rows go through `useOnResolve` into `mediaInserter` into `upsertMedia`, byte for byte the
path a built-in takes. A `SAME_AS` handle between two RUN-scoped rows becomes `graph.link`, a
union-find union with **no inverse**: the two uris are one cluster from that moment, for the life of
the store, and no later answer from any source can separate them. `enforcePluginOrigin` checks the
origin of the answer and never the origin of a handle inside it, so the one claim that is permanent is
also the one claim that is unchecked. Disabling the plugin afterwards removes its entry from
`extractors` and unsubscribes it; it does not undo one union. See
[the graph](/write/graph/) and [scopes and relations](/write/scopes-and-relations/).
:::

## The context a plugin resolver receives

A built-in resolver is handed an `ExtractorServerContext` with four members
(`src/worker/extractor.ts:41-50`): `fetch` (the backoff-wrapped proxy fetch), `findAggregatedMedia`,
`listenForMediaChanges`, and `similarMedia`. A plugin resolver is handed one object with one function
and the viewer's languages, minted per call at `src/worker/extractor.ts:682`:

```ts
for await (const payload of await subscribe(undefined, args, { similarMedia: similarMediaFrom(origin), languages: heldViewerLanguages() })) {
```

`languages` is `{ language, audio?, subtitles? }` in BCP 47 tags (`ViewerLanguages`, `src/plugin-api.ts`):
the browser's first language, and the audio and subtitle languages last picked in a player, subtitles off
as `null` and a pick naming no language left out. The page hands them to the worker at start and on every
pick (`src/viewer-languages.ts`), as it hands the country, and `play` gets the same object beside the
release. Both are additive to `stub-source@1`: an older plugin reads neither.

`src/worker/extractor.ts:673-681` is the argument for that one function being there at all:

> The ctx a plugin sees is EXACTLY one function and never the real one. Stub's privileged
> context, the proxy fetch and the store reads, still does not cross to third-party code; what
> crosses is the ability to ask a first-party source "which run of this show is the one this
> evidence describes", which is the same question the app asks on the plugin's behalf anyway.
> The surface is narrow: scalars and strings that every implementation compares rather than
> interpolates into a url, answered with a media the app was going to fetch anyway. Beside it,
> plain strings: the viewer's languages, read when the call is made.

No source takes a key from the viewer since 2026-10-07, so a plugin's question spends nobody's key.

Three bounds hold that surface, all of them in the same file:

- **The caller is the plugin's own origin.** `similarMediaFrom(origin)` binds the budget to it, and
  `MAX_SIMILAR_MEDIA_PER_CALLER = 8` (`src/worker/extractor.ts:227`) is a per-caller share of the
  global `MAX_CONCURRENT_SIMILAR_MEDIA = 32` (`:216`). The comment at `:218-226` names the exact
  scenario: a plugin whose `similarMedia` never yields holds a slot for the full
  `SIMILAR_MEDIA_TIMEOUT_MS = 30_000` (`:198`), and enough of those would pin the global ceiling so
  that "the next FIRST-PARTY ask is refused: the page looks exactly like a source that had no answer".
  A per-caller share "cannot stop a plugin wasting its own budget, which is fine, and does stop it
  spending anybody else's".
- **The show id is validated once, centrally.** `SAFE_SHOW_ID = /^[A-Za-z0-9._~-]{1,128}$/`
  (`src/worker/extractor.ts:244`). The comment at `:229-243` is explicit that a plugin is what made
  this necessary: "This endpoint is the first place an id is chosen by the CALLER, and a plugin is a
  caller."
- **`similarMediaFrom` answers a media or `undefined`** (`src/worker/extractor.ts:403-409`), never an
  outcome, so a plugin learns nothing about why it got nothing.

Only the fields the plugin actually declares are installed (`src/worker/extractor.ts:629-633`), so a
plugin that ships `media` alone keeps `makeExtractor`'s yield-null defaults for `mediaPage` and
`similarMedia`. That also keeps `implementsSimilarMedia` (`:292-295`) honest for plugins, since it
reads the definition's resolvers rather than the merged schema, and a plugin that does not declare the
field is never subscribed to for it. The `if (!subscribe) return` guard at `:606` is defensive: the
delegate is only installed when that same expression is truthy, and the payload is materialized rather
than live. Were it ever to fire, the generator would complete without yielding, which is a 204 No
Content to the caller.

## Built-in against plugin, on the axes that decide something

The discriminator is one field. `makeExtractor` returns `pluginUri: undefined as string | undefined`
(`src/worker/extractor.ts:547`) and only `registerRemoteExtractor` sets it (`:682`). Every difference
below is a test of that field or a consequence of how the entry was built.

```mermaid
flowchart TD
  E["one entry in the module-level extractors array"]
  D{"is this entry a plugin's?<br/><small>entry.pluginUri !== undefined</small>"}

  CTXB["ctx: fetch, findAggregatedMedia,<br/>listenForMediaChanges, similarMedia"]
  ASKB{"re-askable from a FOREIGN origin?<br/><small>origins.includes(source.origin) || (source.supportedUris ?? []).some(origin =&gt; origins.includes(origin))</small>"}
  YESB["anizip and offline: the two built-ins with a wider supportedUris"]
  NOB["the other 22: matched on their own origin"]
  ENFB["payloads pass through untouched:<br/>no origin check, no handle rewrite"]
  TEARB["never removed from the registry"]
  EXPB["exported by exportStore like any other origin"]

  CTXP["ctx: similarMedia, and nothing else"]
  ASKP["supportedUris is absent from PluginSourceMeta,<br/>so the second disjunct is always false:<br/>matched on its origin alone"]
  ENFP["readPluginPayload, then enforcePluginOrigin,<br/>on every yielded payload"]
  TEARP["closed, unregisterRemoteSource,<br/>splice in reverse index order, leaveFanout"]
  EXPP["force-excluded worker-side:<br/>excludeOrigins gains extractors.filter with a pluginUri"]

  E --> D
  D -->|"pluginUri is undefined: a module in src/sources"| CTXB
  D -->|"pluginUri names the package it came from"| CTXP
  CTXB --> ASKB
  ASKB -->|"a foreign id it declared"| YESB
  ASKB -->|"only its own origin"| NOB
  YESB --> ENFB
  NOB --> ENFB
  ENFB --> TEARB
  TEARB --> EXPB
  CTXP --> ASKP
  ASKP --> ENFP
  ENFP --> TEARP
  TEARP --> EXPP

  classDef irrev fill:#fbeae7,stroke:#b03f33,color:#3a1512
  classDef ratchet fill:#faf1e0,stroke:#8f5a0e,color:#3a2a08
  classDef view fill:#e9eef7,stroke:#4572b5,color:#16283f
  classDef refuse fill:#f0f0f2,stroke:#7b7d85,color:#33343a
  class EXPP,ENFP refuse
```

*The right-hand lane is the whole of the reduced contract. Everything not on it, the schema, the
defaults, the fan-out join, the DataLoaders, the store, is shared.*

| axis | a built-in | a plugin |
| --- | --- | --- |
| definition | a module namespace in `src/sources/index.ts` | `PluginSourceMeta` plus `makeDelegatingResolvers`, `src/worker/extractor.ts` |
| `supportedUris` | declared, read by `answersForOrigins` | absent from `PluginSourceMeta` (`src/worker/plugin-sources.ts:21-30`), so the re-ask matches on origin alone |
| where resolvers run | in the worker | in the package's own frame, reached over the port |
| context | four members (`src/worker/extractor.ts:41-50`) | one function and the languages, `{ similarMedia: similarMediaFrom(origin), languages }` |
| origin enforcement | none | `enforcePluginOrigin` per payload, nested handles exempt |
| handle shape | edges, as the schema declares | bare rows accepted, `readPluginHandles`, media depth 4, episode depth 1 |
| identity | whatever the module exports | `/^[a-z0-9][a-z0-9-]{0,31}$/`, and must not collide |
| teardown | never | `closed`, `unregisterRemoteSource`, splice plus `leaveFanout` |
| store export | included | force-excluded worker-side (`src/worker/yoga.ts:71-79`) |

### The re-ask matches a plugin on its origin alone

`askOrigins` is the only place origin matching decides anything at all, and it reads the definition
through a structural cast (`src/worker/extractor.ts:829-830`). `src/worker/extractor.ts:827-828`:

> A PLUGIN source is matched on its origin alone: `PluginSourceMeta` carries no `supportedUris`
> (see plugin-sources.ts), so a third party answering from a foreign id keeps the old behaviour.

`answersForOrigins` is `origins.includes(source.origin) || (source.supportedUris ?? []).some(...)`
(`src/sources/supported.ts:27-29`). With `supportedUris` undefined the `?? []` makes the second disjunct
unconditionally false, so a plugin is re-asked exactly when its own origin appears in the widened uri.
Concretely: a plugin publishing under `nyaa:` is re-asked once the cluster gains a `nyaa:` handle from
somebody else, and never on the strength of a `mal:` id it might understand perfectly well. The first
fan-out still asks it unconditionally, like everyone else; see [the fan-out](/request/fan-out/) and
[the re-ask](/request/re-ask/).

### Teardown removes the entry, not the rows

`unregisterRemoteExtractor` (`src/worker/extractor.ts`) drops the plugin's pickers and players,
walks `extractors` from the end so the splices do not shift indices under the loop, and calls
`leaveFanout` for every fan-out still open, which unsubscribes and removes the subscription from both
`joined` and `subscriptions` (`:768-775`). The discriminator inside that loop is
`if (entry.pluginUri !== pluginUri) continue`, and a built-in's `pluginUri` is `undefined`, so the
guard is doing real work: both call sites (`src/plugins.ts:93` on frame death and `:133` in
`disablePlugin`) always pass a uri string.

:::caution[Unregistering is not undoing]
Teardown is about the registry and the in-flight subscriptions. Every row the plugin wrote is still in
the store, every union it caused is still a union, and every `PART_OF` edge it hung is still an edge.
`resetStore` is the only thing that clears any of it. A plugin that welded two clusters stays welded
after it is disabled and after the page is reloaded.
:::

### The export exclusion is decided in the worker

`src/worker/yoga.ts:71-79`:

> the plugin origins are derived HERE rather than taken from the caller, so a caller cannot decline
> to exclude them: a plugin's rows are that user's, never the product's.

```ts
excludeOrigins: [
  ...(options?.excludeOrigins ?? []),
  ...extractors.filter(entry => entry.pluginUri).map(entry => entry.extractor.origin),
],
```

`exportStore` takes `excludeOrigins` to mean more than "leave these rows out". Its header
(`src/worker/store/export.ts:16-17`) says so:

> It refuses to walk THROUGH an excluded origin, so a bridge only an excluded source supplied splits
> rather than surviving.

So an export does not merely omit a plugin's rows; it refuses to *traverse* them, and a cluster held
together only by a plugin's handle comes out of the export as two clusters. Note what that does and
does not achieve: it keeps a plugin's claims out of the export, and it changes nothing about the live
store, where the union already happened. See [exporting](/read/export/).

## Whether a source needs an account

Two optional fields on a source, additive to `stub-source@1` like `onPlayback` and `buffer`, so an older
plugin needs no change and gets no new contract tag (`src/plugin-api.ts`):

```ts
access?: 'none' | 'account' | 'paid'
account?: () => Promise<'signed-in' | 'signed-out' | 'no-plan'>
```

- **`access`** says what playing the source's releases needs. `readPluginSources` reads anything but
  `'account'` or `'paid'` as `'none'`, so every plugin written before it routes as it did. The page
  learns it with the registration (`RegisteredSource.access`), so it is known the moment the source joins
  Play's order. Both levels route alike; `'paid'` says a plan is part of the answer.
- **`account`** is asked, not pushed: stub asks when Play weighs the source, once for each episode the
  watch page opens, as it asks `buffer` and `selectRelease`, so a plugin keeps no listener and stub keeps
  no subscription. The worker asks it on the connection the source registered over, only when `access`
  is not `'none'`, and waits `ACCOUNT_WAIT_MS = 3_000` at most (`src/worker/plugin-sources.ts`). A late
  answer, a rejection or any other value is no answer.
- **The answer stays in the page's memory** (`src/plugin-accounts.ts`). It is never written to storage,
  never synced and never sent anywhere.

Play reads it as it reads stub's own Crunchyroll and Prime Video, by the owner's rule of 2026-10-26: a
viewer seen signed in before is asked to sign in again, and one never seen signed in gets the release
that plays with nothing to fix.

| what the source said for this episode | plays with nothing to fix | as Play's favourite, it |
| --- | --- | --- |
| it needs no account | yes | opens |
| `signed-in` | yes | opens |
| `signed-out` or no answer, after a `signed-in` earlier in this page | no | opens, for its own player to ask the viewer to sign in again |
| `signed-out` or no answer, with no `signed-in` before; no `account` | no | gives way to a release that plays with nothing to fix, and with none, opens |
| `no-plan` | no | gives way, since a sign in cannot fix it, and with none, opens |

While its answer for the episode is out, for `ACCOUNT_WAIT_MS` at most, the source is not settled, so
Play opens nothing ranked below it, and it is not free, whatever it said for the episode before. The
page does not wait: the source list's links come from the player lookup, which the ask never holds.

## What a plugin asks the viewer for

Two optional fields on the connection, beside `origin` on a single source or beside `sources` on a family,
so one form serves the whole package. Both are additive to `stub-source@1`: a plugin without them connects
as before and shows no form (`src/plugin-api.ts`).

```ts
settings?: { key: string, label: string, kind: 'text' | 'url' | 'secret', required?: boolean }[]
configure?: (values: Record<string, string>) => Promise<void>
```

- **`settings`** lists the fields. Once the package connected, its row in Settings, under Sources, shows a
  small form for them. `label` is shown as written, so it is the plugin's own words in its own language. A
  `url` field holds an address, and a `secret` is a password input. A malformed or repeated field is dropped
  on its own, and so is one keyed like a member of every object, such as `constructor`.
- **`configure`** is handed the values by `key`, with a field left empty not there. It is called on every
  connection, before the package's sources join any fan-out, so a search never reaches a plugin still waiting
  for its address, and at once when the viewer saves. The player's own document (`packages.mount`) takes them
  too, before each `play`. The first call may hold nothing.
- **A required field left empty** shows in one line on the row. It blocks nothing: the package stays connected
  and is asked as usual, so it answers what it can without the value.
- **A rejection or a late answer changes nothing.** Stub waits `CONFIGURE_WAIT_MS = 3_000` at most and then
  goes on, and drops what the plugin rejected with unread, since it could quote a value.

Signed out, the values stay in this browser, per site, under `'stub-plugin-values'`, not encrypted, and go when
the source does. Stub never logs them and never puts one in a url.

Signed in, they follow the account as the source list does, and through the same step (`src/plugin-sync.ts`). They
are stub's, not FKN's: `sources/v1/values.json`, sealed in the browser like the list, needing no FKN change.

- **Beside the list, not in it.** A client older than the values rewrites `sources/v1/list.json` as an array of
  strings, so it would drop them. It never opens the other file.
- **Values entered signed out join at sign in,** where the account has no value of its own, and leave the device,
  as an addition does.
- **The later save of a field wins,** and a save only marks the fields it changed, so two sites saving different
  fields keep both. No lock spans two sites, so a save stays in the page until a read shows the file holding it,
  and a write that went over it is repaired by the next check.
- **The file holds only the sources on the list just read,** so a removal anywhere removes their values everywhere,
  a removal by an older client included.
- **At sign out** the account's copy leaves this browser with the list, and the account keeps the file.

A connected source takes values another site saved at the next check, through `configure`.

## What is not reduced

Worth stating plainly, because the list of restrictions above can read as a sandbox and it is not one.

A plugin gets the same generated `typeDefs` as the app and every built-in
(`src/worker/extractor.ts:416`), so the page's document validates against its schema and is replayed at
it verbatim. It gets the same `merge(defaults, resolvers)` defaults, so an omitted list field is `[]`
rather than a null that would take its parent down with it. It gets the same `useOnResolve` hook and
therefore the same three DataLoaders and the same `upsertMedia` (`:473-495`). It is joined to every
in-flight fan-out at the moment it registers (`:689`), with the original variables and the original
request context, so a package that finishes connecting halfway through a page load still answers that
page's question. It can register a `selectRelease` picker and a `play` handler and become the thing
that actually plays an episode (`:637-662`). And its answers are subject to exactly the same
consensus, scoring and merge rules as anybody else's, with no discount for being third-party.

The reduction is four checks wide. Everything else, including the part that is permanent, is shared.
