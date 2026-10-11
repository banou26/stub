---
title: Credits
description: "mergeCredits: how AniList's and Anime News Network's characters and staff become one list, who counts as one person, and what is drawn when two sources disagree."
---

A title page shows one list of characters and one of staff, merged from every source that sent
credits. Today that is AniList (score 0.8) and Anime News Network (ANN, 0.2), which answers only the
title page (`details`) and only for an `ann:` id the offline source names. The merge is
`mergeCredits` in `src/worker/graph/plugins/credits.ts`, called by `aggregateFields`. It is a view,
rewritten on every pass, and never a graph link: a wrong rule is a code fix and an
`AGGREGATE_VERSION` bump.

## Who is one

Everything is decided inside one title's credits. Sources are read in score order.

| Entry | One when |
| --- | --- |
| any | they share an id, inside one source (AniList lists a person once per job) or across sources |
| character | a name key of one equals a name key of the other, it reaches exactly one character on each side that has ids, and they share a voice actor in one language, a Japanese one whenever both list Japanese actors |
| staff | their name keys are equal and name exactly one person in each source's list; jobs never decide |
| voice actor | never on its own: an actor stays under its own source's character |

AniList's names are a character's full name and its alternatives; ANN's are its cast role strings.
ANN has no character ids, so several of its strings can join one character, one per dub's spelling
("Eren Jaeger" and "Eren Jäger"), judged together for the shared actor; each string joins at most one.
A refusal draws both entries: a missed merge, never a wrong one.

### The name key

`nameKey` folds a name so two spellings meet, and nothing more:

1. One comma means "Family, Given": "Yamadera, Kouichi" becomes "Kouichi Yamadera".
2. NFKD, combining marks dropped, lower case: "Unshō" is "unsho".
3. A quoted nickname and a one-letter initial with a dot are dropped: "Christopher R. Sabat".
4. Anything not a letter or a digit becomes a space. Word order is kept.
5. `ou` and `oo` to `o`, `uu` to `u`, `oh` to `o` before a consonant other than `n` or at the end of
   a word: "Ooba" and "Ohba" meet, "Ohno" and "Ono" do not.

## Measured

Over 10 shows, AniList's first page of characters against ANN (HOR-348, 2026-10-12):

| Measure | Result |
| --- | --- |
| AniList characters matching ANN's by name | 172 of 239, 167 of them sharing an actor |
| the whole character rule, Cowboy Bebop, Fullmetal Alchemist: Brotherhood, Frieren | 52 of 54 pass; 1 refused for no actor in common, 1 for a Japanese actor spelled two ways |
| people joined by name that Wikidata can check | 312: 305 agree, 5 are one person under two ANN pages, 1 is a Wikidata id ANN does not know, 1 is two live ANN pages read as one |
| staff joined by name that Wikidata can check | 42 of 42 agree |

## Refused

| Rule | The case that refused it |
| --- | --- |
| ids only | AniList and ANN share no character id, so 0 of 53 shared characters would join |
| a character reached through its Japanese actor alone | Death Note's Masahiko Kida and ANN's "Anthony Rester" share Masaki Aizawa; AniList's page of 25 hides his other role |
| sorting name words | José Leonardo (AniList 105003, born 1973) and Leonardo José (194141, born 1943) would be one |
| edit distance | it joins on likeness; "Tsutomu Tareki" and "Tsutomu Taruki" stay two |
| a shared job for staff | loses 12 of 37 name matches on 3 shows, with no wrong match to stop |

## What is drawn

| Field | Shown |
| --- | --- |
| name, image, url, role | the first source that has one; a character only ANN lists has no face and no role |
| voice actors | per character and language, the whole set from the first source listing any actor in that language: ANN adds only the dubs AniList does not list |
| order | MAIN, SUPPORTING, BACKGROUND, then unstated, each in the first source's order, so characters only ANN lists come last, behind Show all |
| staff jobs | every source's words, notes in parentheses dropped, deduped case-insensitively |

The tests are in `tests/unit/worker/graph/plugins/credits.test.ts`, on trimmed real rows of both
sources in `tests/fixtures/credits/`.
