---
title: Credits
description: "mergeCredits: how AniList's, MyAnimeList's, Anime News Network's and live action's characters and staff become one list, who counts as one person, and what is drawn when two sources disagree."
---

A title page shows one list of characters and one of staff, merged from every source that sent
credits. Today that is AniList (score 0.8), MyAnimeList (its credits at 0.7, [below](#myanimelist)) and
Anime News Network (ANN, 0.2), which answers only the title page (`details`) and only for an `ann:` id
the offline source names. The merge is
`mergeCredits` in `src/worker/graph/plugins/credits.ts`, called by `aggregateFields`. It is a view,
rewritten on every pass, and never a graph link: a wrong rule is a code fix and an
`AGGREGATE_VERSION` bump.

## Who is one

Everything is decided inside one title's credits. Sources are read in score order: their credits'
own `score` when they carry one, else their row's.

| Entry | One when |
| --- | --- |
| any | they share an id, inside one source (AniList lists a person once per job) or across sources |
| character | a name key of one equals a name key of the other, read in either word order ([below](#the-other-word-order)), it reaches exactly one character on each side that has ids, and they share a voice actor in one language, a Japanese one whenever both list Japanese actors |
| staff | their name keys are equal, in the same word order, and name exactly one person in each source's list; jobs never decide |
| voice actor | never on its own: an actor stays under its own source's character |

AniList's names are a character's full name and its alternatives; MyAnimeList's its one name; ANN's
its cast role strings.
ANN has no character ids, so several of its strings can join one character, one per dub's spelling
("Eren Jaeger" and "Eren Jäger"), judged together for the shared actor; each string joins at most one.
A refusal draws both entries: a missed merge, never a wrong one.

### The name key

`nameKey` folds a name so two spellings meet, and nothing more:

1. One comma means "Family, Given": "Yamadera, Kouichi" becomes "Kouichi Yamadera". A suffix after
   the comma (Jr., Sr., II, III) stays where it is: "Walter White, Jr." is "Walter White Jr.".
2. NFKD, combining marks dropped, lower case: "Unshō" is "unsho".
3. A quoted nickname and a one-letter initial with a dot are dropped: "Christopher R. Sabat".
4. Anything not a letter or a digit becomes a space. Word order is kept.
5. `ou` and `oo` to `o`, `uu` to `u`, `oh` to `o` before a consonant other than `n` or at the end of
   a word: "Ooba" and "Ohba" meet, "Ohno" and "Ono" do not.

A quoted nickname is also read as another name, in place of the word before it, for characters and
staff alike: "Michael 'Mike' Ehrmantraut" is "Mike Ehrmantraut" too. Nicknames, a row's and those of
the entries before it, are tried only when the row's own names reach no entry's names, under the same
rule (a key must name exactly one entry on each side), and a nickname never replaces the name drawn.

### The other word order

A character's key is also read with its first word moved to the end, as a nickname is read: tried
only when a row's own names reach no entry, under the same rules, and never drawn. AniList writes
"Dracule Mihawk" and "Luffy Monkey", ANN "Monkey D. Luffy" and "Boa Hancock", and MyAnimeList's
"Dracule, Mihawk" and "Boa, Hancock" are read "Mihawk Dracule" and "Hancock Boa". One direction is
enough, since a row's other keys meet an entry's names and its names an entry's other keys, and a
longer name turns at its first word too: ANN's "Riku Dold III" meets MyAnimeList's "Dold III Riku".

When two rows of a source with ids reach one entry, the one reaching it by its own names joins and
the other starts an entry: MyAnimeList's Hideki Ryuuga, the idol, reaches Death Note's L through L's
alias "Ryuga Hideki", and MyAnimeList's L still joins L. A source without ids joins the rows reaching
the entry by their own names, judged together, and each row reaching it only in the other order that
shares an actor on its own: ANN's "Vinsmoke Niji" (the Japanese dub) shares Niji's Japanese actor and
"Niji Vinsmoke" (the German one) comes with it by its own name, while ANN's idol "Hideki Ryuga" never
rides into L on the actor of ANN's "L Lawliet".

People keep word order: nothing but the name joins two staff entries, and AniList's José Leonardo
(105003, born 1973) and Leonardo José (194141, born 1943) are two people.

Measured on Cowboy Bebop, One Piece, Death Note and Fullmetal Alchemist: Brotherhood with AniList,
MyAnimeList and ANN (pages saved 2026-10-13, measured 2026-10-15):

| Measure | Before | After |
| --- | --- | --- |
| rows joined | | 54 more, none lost, none wrong: each is one name in the other order with an actor in common, and the two that both AniList and MyAnimeList list carry one number on both (Mihawk 2064, Basque Grand 2439) |
| One Piece, characters drawn | 1815 | 1762 |
| One Piece, names drawn twice: exact, by name key, by word set | 31, 51, 102 | 30, 47, 54 |
| One Piece without MyAnimeList, characters and word-set duplicates | 482, 38 | 473, 30: 8 of AniList's 25 characters (Luffy, Zoro, Robin, Chopper, Vivi, Ace, Doflamingo, Blackbeard), written "Luffy Monkey" against ANN's "Monkey D. Luffy", are drawn once |
| Death Note, characters drawn | 95 | 94: AniList's "Teru Mikami" joins ANN's "Mikami Teru" |
| Death Note's L | AniList's and MyAnimeList's "L Lawliet" one entry, ANN's "L" its own, as on main | the same |
| One Piece, voice actors drawn | 7337 | 7142: a language's actors come whole from the first source listing it, so a later source's other dub in that language goes with its second card |
| Fullmetal Alchemist: Brotherhood, characters drawn | 140 | 139: AniList's "Grand Basque" joins MyAnimeList's "Basque Grand" |
| Cowboy Bebop | 134 | 134 |
| staff drawn on the four shows | 153, 675, 248, 511 | the same |
| 15 more shows (Naruto, Bleach, Dragon Ball Z, Solo Leveling and 11 others): rows joined, then Bleach's and Solo Leveling's characters | 357, 95 | 42 more, none wrong; 343, 80 |

Of One Piece's 54 word-set duplicates left, 7 are one name in two orders with no actor in common (ANN's
"Gol D. Roger" lists only Spanish and Portuguese actors MyAnimeList's "Roger Gol D." does not, ANN's
"X Drake" and "X-Drake" only dubs MyAnimeList's "Drake X" does not), 4 are
ANN strings naming two names around a slash in either order ("Bon Clay / Mr. 2", "Mr. 2 / Bon Clay"),
and the rest one spelling drawn twice, refused as before: two MyAnimeList characters of one name (two
"Kaku"), or no actor in common. Read for staff too, the other order would join two more people on the
four shows (ANN's "Jang Kil Yong" and MyAnimeList's "Kil-yong Jang", "Nozomu Shishido" and "Shishido
Nozomu"), and José Leonardo and Leonardo José with them.

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
| sorting name words, or the other word order for people | José Leonardo (AniList 105003, born 1973) and Leonardo José (194141, born 1943) would be one |
| two rows reaching one entry, one by its own names and one in the other word order, both refused | Death Note's L would be drawn twice: MyAnimeList's Hideki Ryuuga reaches him through his alias "Ryuga Hideki" |
| a source without ids' rows in the other word order judged with the rest | ANN's idol "Hideki Ryuga" would join L on the actor of ANN's "L Lawliet" and not be drawn at all. Judged alone, 7 ANN strings naming only dubs are drawn as their own cards on 19 shows, One Piece's "X Drake" and "X-Drake" and Bleach's "Kurosaki Ichigo" among them |
| edit distance | it joins on likeness; "Tsutomu Tareki" and "Tsutomu Taruki" stay two |
| a shared job for staff | loses 12 of 37 name matches on 3 shows, with no wrong match to stop |

## What is drawn

| Field | Shown |
| --- | --- |
| name, image, url, role | the first source that has one; a character only ANN lists has no face and no role |
| voice actors | per character and language, the whole set from the first source listing any actor in that language: ANN adds only the dubs neither AniList nor MyAnimeList lists |
| order | MAIN, SUPPORTING, BACKGROUND, then unstated, each in the first source's order, so characters only ANN lists come last, on the last pages |
| staff jobs | every source's words, notes in parentheses dropped, deduped case-insensitively |

## MyAnimeList

The `mal` source reads one more page for the title page's request alone,
`myanimelist.net/anime/<id>/_/characters`: any slug serves it, and without one the site answers the
title page. It lists every character with every dub, and every person with every job: 126 characters,
569 actor rows and 121 people on Cowboy Bebop (1 MB), 1481 characters on One Piece (10 MB).

| Choice | Why |
| --- | --- |
| credits read at 0.7, after AniList's | its row scores 0.9, but the first source read sets each shared character's name, face and url and each language's whole cast, and this page lists staff by job where AniList lists by relevance: read first, Bebop's characters would link to MyAnimeList and its staff would open on three producers. Read second, it adds what AniList's 25 leave out, and a language AniList lists stays AniList's |
| characters by favorites | the page's own "Favorites" sort: what AniList leaves out comes as Ein, Vicious, Gren, Julia, and so does the whole list when AniList has not answered |
| "Given Family" | the page writes "Spiegel, Spike" and "Yamadera, Kouichi". `nameKey` reads one comma that way already, so joins hold either way; the name drawn is the first source's, MyAnimeList's for everyone AniList does not list. `givenFirst` is `nameKey`'s own rule, suffixes kept |
| ids `mal:<id>` | the page's character and person numbers, as AniList's are `anilist:<id>`. AniList took its older ids from MyAnimeList, so 130 of the 136 same-name pairs below share a number (Punch is 6693 on both), but newer ones do not (Spirited Away's Aogaeru is 279064 and 236451), so a number is not read as one character |
| faces | the plain 225x350 file behind the page's 42x62 crop, as large as AniList's; the question mark placeholder is no face |
| languages | the page's words through `languageCode`; "Portuguese (BR)" is `pt` |

Measured on Cowboy Bebop, One Piece, Spirited Away, Fullmetal Alchemist: Brotherhood, Death Note and
Attack on Titan (2026-10-13), AniList's first page against this one:

| Measure | Result |
| --- | --- |
| AniList characters sharing a name with MyAnimeList's | 136 of 141; 131 join, 5 refused, all on Spirited Away: Kaonashi's Japanese actor differs, 4 list no actor on one side. 2 of the other 5 share it only in the other word order and join through it: One Piece's "Dracule Mihawk" and "Mihawk Dracule", Fullmetal Alchemist: Brotherhood's "Grand Basque" and "Basque Grand" |
| AniList staff sharing a name with MyAnimeList's | 104 of 142 people, all 104 join |
| One Piece with ANN too | 1762 characters drawn (473 without MyAnimeList) and 675 people (264); 54 names drawn twice or more with word order ignored (30), 47 by `nameKey` (26), [above](#the-other-word-order) |
| voice actors against AniList and ANN alone, 19 shows (2026-10-15) | 282 actor credits drawn before are not, 181 of them naming no actor drawn there under the same name key: a language's cast comes whole from MyAnimeList before ANN, and MyAnimeList lists one Spanish and one Portuguese dub where ANN lists Spain's and Latin America's, Portugal's and Brazil's (One Piece's Luffy loses ANN's Spanish "Desireé González"), and a dub a second card carried goes when the card joins. 216 (134) go with MyAnimeList's credits alone, before the other word order |
| One Piece's cost | MyAnimeList's credits keep the whole page, where AniList, IMDb and TMDB stop at about 25 characters: 1481 characters, 6701 actor rows and 544 people, 1.7 MB of JSON in its row, parsed in 21 ms off the 10 MB page. The merged credits sent to the title page grow from 252 KB to 1.5 MB, and a merge takes 70 ms (9 without MyAnimeList; medians of 15 on this machine), more than half of it spent scanning every entry for each row. Opening the title page (2026-10-15, 4 opens each, MyAnimeList's pages served from disk), the merge runs 10 to 12 times as sources answer, 400 to 510 ms of the worker's time (40 to 70), all 147 pages are there 2.4 to 3.5 s after the open (40 pages at 1.9 to 2.4 s), and the page's long tasks grow by about 40 ms. From myanimelist.net the credits page takes 6.6 to 8.8 s on a first fetch (875 KB on the wire) and the title page 4.1 to 4.3 s, so the row answers with its title page and its credits follow. Nothing is capped but the page drawn, 12 at a time |
| Cowboy Bebop with ANN too | 134 characters (32), no name drawn twice that was not before; merged credits 49 KB to 144 KB, 4 ms to merge (1) |

## Live action

IMDb (0.3: the first 25 actors, each under the first part it lists for them, and the directors,
writers and creators it lists first), TVmaze (0.3: the show's cast and crew) and JustWatch (0.2: actors
and directors) send credits only with the title page's request, inside the request each already makes,
so the modal's and the listing's stay as they were. TMDB (0.3) asks one more page for a series that is
not an anime, `/tv/<id>/cast`, only with the title page's request, and reads the first 25 of its
actors, each under the first part it names. Its crew is not read: it lists every one-off director in
alphabetical order (36 rows on Breaking Bad), and IMDb's credits already carry the principal ones.
Each actor stands under their part with a null language: the same rules join them through the actor
on screen, and the page draws no language picker.
A part that names no character ("Self", "Himself") is left out, so a documentary's or a talk show's
people show only where a source credits them as staff.

An anime's cast on IMDb, TVmaze or JustWatch names no language and shares no actor with AniList's, so
it would draw each character a second time. So beside a source whose characters carry no null
language (AniList, ANN, even before any actor is listed), the casts with a null language add no
characters. Their staff still join.

On Breaking Bad (2026-10-12, the fixtures), IMDb, TVmaze and JustWatch list 12 parts. Before the
suffix and nickname rules they were 15 entries: "Walter White, Jr." flipped at its comma, and TVmaze's
"Michael 'Mike' Ehrmantraut" and "Gustavo 'Gus' Fring" missed IMDb's "Mike Ehrmantraut" and "Gus
Fring". With both rules they are 12. With TMDB read as well, sources run IMDb, TMDB, TVmaze,
JustWatch, and two parts are still drawn twice: TMDB's "Gustavo Fring" reaches nothing of IMDb's
"Gus Fring", so TVmaze's row joins TMDB's by its own name; and TMDB's "Todd" never meets "Todd
Alquist".

The tests are in `tests/unit/worker/graph/plugins/credits.test.ts`, on trimmed real rows of every
source in `tests/fixtures/credits/`.
