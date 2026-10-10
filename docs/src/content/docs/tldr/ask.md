---
title: The ask
description: "How one uri in the address bar becomes 25 concurrent subscriptions, what each source does with one, and why the answers never come back down the path they went out on."
---

One uri becomes 25 concurrent GraphQL subscriptions, one per registered source, each against a private yoga replaying the page's own document. Nothing picks which sources to ask: every source gets the question and decides for itself whether it names them.

## The gate

wouter hands a route segment through undecoded, so every uri passes `decodeRouteUri` (src/utils/uri.ts:162-170) at the router (media-modal.tsx:599, watch/index.tsx:177-182) and again in the worker (src/worker/resolvers/media/index.ts:33). It must then satisfy `isUri(uri) || isAggregatedUri(uri)`; anything else logs `media: refused '<uri>', which names no uri` and returns **without yielding** (:34-37): yoga answers 204 No Content and the page holds `data === undefined` forever, no error anywhere. Inside a source the rule inverts: a refusal is a `yield` of null and never a return (defaults at src/worker/extractor.ts:457-463), or a `similarMedia` generator ending silently would hold its caller for `SIMILAR_MEDIA_TIMEOUT_MS = 30_000` (:198).

| | `Subscription.media` | `Subscription.mediaPage` |
| --- | --- | --- |
| uri gate | `decodeRouteUri` then `isUri \|\| isAggregatedUri` (media/index.ts:33) | none |
| root operation | `MEDIA` (media/index.ts:39) | `MEDIA_PAGE` (media/index.ts:100) |
| reads the fan-out payload | no | yes, via `extractUris` on `mediaPage.nodes` |
| re-ask | `askOrigins` on every newly named origin | none |
| re-read trigger | `media:changed`, `episode:changed` | `media:changed`, debounced 100ms |

## The fan-out

`proxyRequestToExtractors` builds one `Fanout` carrying `ctx.params.query`, the page's literal document, then runs one loop: `for (const extractor of extractors) joinFanout(fanout, extractor)` (worker/extractor.ts:792). `joinFanout` contains exactly one test, `if (fanout.joined.has(extractor)) return` (:747). It reads neither the uri, nor `supportedUris`, nor `origin`. `extractors` is a mutable module singleton (:551, mutated at :683 and :719), so "every registered source" means every source registered when that loop runs: 25 today ([the registry](/tldr/sources/)), plus one per source a connected plugin registers.

On the MEDIA path every payload is dropped on the floor: rows reach the store down a side channel ([the write path](/tldr/write/)), the store emits `media:changed`, and the resolver re-reads the cluster and yields the aggregate (media/index.ts:81-87). Reading a source's answer says nothing about whether it answered: [the fan-out](/request/fan-out/).

## Self-selection

A source recognises itself by finding its own handle inside the uri it was handed: `extractAggregatedUriOrigin(uri, origin)` (utils/uri.ts:43-46), which picks the most specific match. Specificity is prefix extension, not length, so the guard carries the hyphen (`startsWith` of the id plus `-`, uri.ts:14-41): without it `cr:G24H1N3MP` beats `cr:G24H1N3MP-GS00374452` in every locale, and a 14 episode season page lists 24 rows.

```mermaid
flowchart TD
  IN["Subscription.media, one payload<br/><small>crunchyroll/extractor.ts:571</small>"]
  IN --> D1{"is this a uri at all?<br/><small>!_uri || !(isUri(_uri) || isAggregatedUri(_uri))</small>"}
  D1 -->|"names no uri: answer 1, refused on shape"| R1["yield media: null<br/><small>:572</small>"]
  D1 -->|"a uri, or an aggregate of them"| D2{"does the uri name a cr: handle?<br/><small>const uri = extractAggregatedUriOrigin(_uri, origin)</small>"}
  D2 -->|"mine: answer 2, asked about the id in hand"| G["getMedia(uri.id, ctx)<br/><small>:574, and getMedia splits the id on '-' into seriesId and seasonId</small>"]
  D2 -->|"no cr: anywhere in the uri"| D3{"is there a cluster to search from?<br/><small>!isAggregatedUri(_uri)</small>"}
  D3 -->|"a bare foreign uri: answer 3, nothing to search on"| R3["yield media: null<br/><small>:576</small>"]
  D3 -->|"an aggregate, so another source may already name the show"| S["searchAndLinkMedia(_uri, ctx)<br/><small>answer 4: discover, under the catalogue gate</small>"]
  G --> Y2["yield media: result ?? null<br/><small>undefined on no seriesId, no series, or a named season that is absent</small>"]
  S --> H["media.handles = buildHandlesFromUri(aggregatedUri, origin)<br/><small>:527, one sameAs per sibling the uri names</small>"]
  H --> Y4["yield media: result ?? null<br/><small>:577</small>"]
  R1 --> END["the generator returns<br/><small>yield-once, no retry, no second payload for this subscription</small>"]
  R3 --> END
  Y2 --> END
  Y4 --> END
  classDef irrev fill:#f7dcd7,stroke:#b03f33,color:#2a1512
  classDef ratchet fill:#f9e6c6,stroke:#8f5a0e,color:#2e2413
  classDef view fill:#dbe6f6,stroke:#4572b5,color:#141d2b
  classDef refuse fill:#e7e7ea,stroke:#9a9aa2,color:#3a3a40
  class R1,R3 refuse
  class H irrev
```

*Crunchyroll answers one uri four ways, and only answer 4 mints a permanent SAME_AS claim.*

Three of the four are the same bytes, `{ media: null }`, so a refusal on shape and a source that found nothing upstream are indistinguishable. jikan is asked every time and refuses every aggregated uri: its gate is `!uri || !isUri(uri)` (jikan/extractor.ts:374) and `isUri` demands exactly two colon-separated parts (uri.ts:71-80), which no aggregate has. On a detail page its rows arrive through `mediaPage`. More at [self-selection](/request/self-selection/).

## What a source is allowed to spend

The root operation rides in the GraphQL variables (a header throws `Cannot convert argument to a ByteString` on user text; urql's operation context does not vary the operation key). Only `token` is read off the wire, and `rootId`, `operation` and `chain` are regenerated from the worker's `hops` registry, so a plugin rewriting them changes nothing (src/worker/request-context.ts:118-127).

| operation | `crossSource` | what it buys | what it costs |
| --- | --- | --- | --- |
| `MEDIA` | true | justwatch turns a `/watch/` url into a Crunchyroll series id | a token plus a CMS request, per film result |
| `MEDIA_PAGE` | false | the offer keeps its url and loses only the identity claim | nothing on a results page reads that id |
| `SIMILAR_MEDIA` | true | `resolveSimilarRuns` proceeds (similar-consumer.ts:281) | never opened as a root; reachable from a test |
| absent | true, `UNKNOWN_POLICY` | today's behaviour, failing open | `misses++` is the only tell (request-context.ts:73, :125) |

Read in exactly two places: justwatch/extractor.ts:372 and similar-consumer.ts:281.

## The re-ask

The uri was captured at subscribe time and `Subscription.media` is yield-once with no retry, so a source whose id arrives a moment later already answered "not mine" and ended. `askUnasked(media.uri)` inside `read()` batches every newly named origin, and `askOrigins` opens a fresh subscription at the sources matching `answersForOrigins` (src/sources/supported.ts:27-29), which reads two sets: the origin a source publishes under, and the foreign origins it can be asked with. Conflating them kills anizip, which mints `anizip:` and answers from a mal id.

| bound | sources | why |
| --- | --- | --- |
| 2 asks | 23 of 25 | one opening ask, plus one for its own origin |
| 4 asks | anizip | `supportedUris = ['anidb', 'mal']` (anizip/extractor.ts:13) |
| 6 asks | offline | `['offline', ...INDEXED_ORIGINS]`, mal, anilist, kitsu, anidb (offline/extractor.ts:48, index-lookup.ts:20) |

`askedOrigins` is a ratchet and the `add` happens **before** `askOrigins` runs (media/index.ts:58-65), so an origin counts as asked whether the subscription started, the upstream answered, or the source threw. `supportedUris` decides who gets a second question, never what comes back: anizip declares `anidb` but its resolver reads only a mal handle (:120-126), so an anidb-only cluster spends a subscription and refuses. The re-ask is targeted rather than a blanket re-fan because nothing caches this: `useResponseCache` sits at ttl 15 minutes (worker/extractor.ts:470) and never fires, since @envelop/response-cache exposes `onExecute` only and all five call sites here are `.subscription(...)`. Derivation in [the re-ask](/request/re-ask/).

## Fetch and backoff

```mermaid
flowchart LR
  SRC["a source resolver<br/><small>ctx.fetch(url, init) - 18 of the 25 sources</small>"]
  CTX["ExtractorServerContext.fetch<br/><small>declared worker/extractor.ts:35, bound worker/extractor.ts:533</small>"]
  WB["fetchWithBackoff = withBackoff(fetch)<br/><small>worker/fetch.ts:18</small>"]
  OSRA["osra hop, key 'fetch'<br/><small>worker/fetch.ts:7-16, worker.ts:24-30</small>"]
  GATE{"is this the season seed on a page that switched it off?<br/><small>refusesSeedAsset(location.href, input)</small>"}
  R404["new Response with status 404<br/><small>'the season seed is switched off for this page'</small>"]
  CLOUD["cloud.fetch(input, init)<br/><small>utils/fetch.ts:5-6, through an FKN node</small>"]
  NET[("the upstream<br/><small>api.jikan.moe, graphql.anilist.co, ...</small>")]

  SRC --> CTX
  CTX --> WB
  WB -->|"attempt 0, and attempts 1 to 3 if it comes to that"| OSRA
  OSRA --> GATE
  GATE -->|"readNoSeedFlag and isSeedAssetUrl both true: refused on the page, never asked"| R404
  GATE -->|"any other request, which is all of them on a normal page load"| CLOUD
  CLOUD --> NET
  R404 -. travels back up as an ordinary Response .-> WB

  classDef irrev fill:#b03f33,stroke:#e0796f,color:#ffffff
  classDef ratchet fill:#8f5a0e,stroke:#f2b45c,color:#ffffff
  classDef view fill:#4572b5,stroke:#8db0de,color:#ffffff
  classDef refuse fill:#46464b,stroke:#8b8c93,color:#f2f2f4
  class R404 refuse
```

*The request leaves the worker and only becomes a network call back on the page, so the seed refusal answers 404, never 503.*

`MAX_RETRIES` is 3 (backoff.ts:17), so four attempts, and `backoffDelay` adds 1s, 2s and 4s of latency with no `console` call anywhere in the module (:37-38). Which statuses buy a retry, and which deliberately do not, is at [/tldr/rules/](/tldr/rules/).

Exhaustion is asymmetric: four retryable statuses in a row end at `return response`, failing status and body intact (:75), four rejections at `throw error` (:71). Both shapes reach the caller, which is why `if (!response.ok) throw` is the only thing between a 503 body and `JSON.parse`. `withBackoff` has no idempotence test, so AniList's `method: 'POST'` (anilist/extractor.ts:287) is retried too, safe only because every POST here is a read. Retried bodies are cancelled, the last one is not (:77). Detail at [fetch and backoff](/request/fetch-and-backoff/).

Nothing comes back the way it went out: the ask is a trigger, the answers are rows, and the page learns what it asked for by re-reading the store. What a source is allowed to put in those rows, and what it must prove before minting an identity claim, is [what a source may claim](/tldr/sources/).
