// The reading order, and the only place it is declared. Starlight's prev/next walks this, so the
// sequence IS the argument the site makes.
//
// TWO TIERS, and the first one is the whole site in about 2% of its words. The deep tier below it is
// 218,892 words across 59 pages, which is more than anyone reads before they need an answer, so the
// condensed tier is the front door and every one of its pages links down into the section it
// compresses. Nothing was deleted to build it.
export const sidebar = [
  { label: 'TL;DR', items: [
    { label: 'stub in one page',          slug: 'index' },
    { label: 'Vocabulary, in one table',  slug: 'tldr/vocabulary' },
    { label: 'The ask',                   slug: 'tldr/ask' },
    { label: 'What a source may claim',   slug: 'tldr/sources' },
    { label: 'The write',                 slug: 'tldr/write' },
    { label: 'The read',                  slug: 'tldr/read' },
    { label: 'The merge',                 slug: 'tldr/merge' },
    { label: 'similarMedia',              slug: 'tldr/similar' },
    { label: 'Every number, and every trap', slug: 'tldr/rules' },
  ]},
  { label: 'The long version', items: [
    { label: 'The whole flow, in full',   slug: 'start/whole-flow' },
    { label: 'Reading these diagrams',    slug: 'start/reading-the-diagrams' },
    { label: 'A run is not a show',       slug: 'start/run-and-show' },
    { label: 'Vocabulary',                slug: 'start/vocabulary' },
  ]},
  { label: 'A request, end to end', items: [
    { label: 'From the address bar to the worker', slug: 'request/page-to-worker' },
    { label: 'The fan-out',               slug: 'request/fan-out' },
    { label: 'How a source recognises itself', slug: 'request/self-selection' },
    { label: 'The re-ask',                slug: 'request/re-ask' },
    { label: 'The request context',       slug: 'request/request-context' },
    { label: 'Fetching, and backing off', slug: 'request/fetch-and-backoff' },
    { label: 'Plugin sources',            slug: 'request/plugins' },
  ]},
  { label: 'Sources', items: [
    { label: 'What a source is',          slug: 'sources/contract' },
    { label: 'The 25, and what each answers', slug: 'sources/registry' },
    { label: 'What a source may mint',    slug: 'sources/what-a-source-mints' },
    { label: 'Scores, and what they decide', slug: 'sources/scores' },
    { label: 'The search gate',           slug: 'sources/search-gate' },
    { label: 'Season-scoped ids',         slug: 'sources/season-ids' },
    { label: 'Worked source: Crunchyroll', slug: 'sources/crunchyroll' },
    { label: 'Worked source: JustWatch',  slug: 'sources/justwatch' },
  ]},
  { label: 'The store: writing', items: [
    { label: 'From an answer to a row',   slug: 'write/answer-to-row' },
    { label: 'upsertMedia',               slug: 'write/upsert-media' },
    { label: 'Scopes and relations',      slug: 'write/scopes-and-relations' },
    { label: 'Claims that wait',          slug: 'write/pending-claims' },
    { label: 'upsertEpisodes',            slug: 'write/upsert-episodes' },
    { label: 'The graph',                 slug: 'write/graph' },
    { label: 'Events, and the re-read loop', slug: 'write/events' },
  ]},
  { label: 'The store: reading', items: [
    { label: 'The five reads',            slug: 'read/entry-points' },
    { label: 'Finding the cluster',       slug: 'read/finding-a-cluster' },
    { label: 'Aggregating a media',       slug: 'read/aggregate-media' },
    { label: 'Aggregating episodes',      slug: 'read/episodes' },
    { label: 'Filters and search',        slug: 'read/filters-and-search' },
    { label: 'Exporting',                 slug: 'read/export' },
  ]},
  { label: 'Merging and consensus', items: [
    { label: 'The fuzzy merge',           slug: 'merge/fuzzy-merge' },
    { label: 'The five gates',            slug: 'merge/gates' },
    { label: 'Consensus, not a sum',      slug: 'merge/consensus' },
    { label: 'Aligning a numbering',      slug: 'merge/alignment' },
    { label: 'Windowing a run',           slug: 'merge/windowing' },
    { label: 'Anomalies',                 slug: 'merge/anomalies' },
  ]},
  { label: 'similarMedia', items: [
    { label: 'Why it exists',             slug: 'similar/why' },
    { label: 'The consumer',              slug: 'similar/consumer' },
    { label: 'The funnel',                slug: 'similar/funnel' },
    { label: 'The rules',                 slug: 'similar/rules' },
    { label: 'The document',              slug: 'similar/document' },
    { label: 'Lending a season',          slug: 'similar/lending' },
    { label: 'The loop, and what stops it', slug: 'similar/loop' },
  ]},
  { label: 'Invariants', items: [
    { label: 'A handle is an identity claim', slug: 'invariants/handle-is-a-claim' },
    { label: 'The three identity spaces', slug: 'invariants/identity-spaces' },
    { label: 'RUN and CONTAINER',         slug: 'invariants/run-and-container' },
    { label: 'A view or a write',         slug: 'invariants/view-or-write' },
    { label: 'Every kind of refusal',     slug: 'invariants/refusals' },
    { label: 'Nothing rather than a guess', slug: 'invariants/nothing-rather-than-a-guess' },
    { label: 'Order is not an input',     slug: 'invariants/determinism' },
    { label: 'The uri grammar',           slug: 'invariants/uris' },
  ]},
  { label: 'The redesign', items: [
    { label: 'The representation',       slug: 'design/representation' },
    { label: 'The corpus',               slug: 'design/corpus' },
  ]},
  { label: 'Reference', items: [
    { label: 'Every constant',            slug: 'reference/constants' },
    { label: 'Every refusal',             slug: 'reference/refusal-index' },
    { label: 'Every log line',            slug: 'reference/log-lines' },
    { label: 'Where the code lives',      slug: 'reference/file-map' },
    { label: 'Known divergences',         slug: 'reference/divergences' },
    { label: 'Streaming platform APIs',   slug: 'reference/streaming-platform-apis' },
  ]},
]
