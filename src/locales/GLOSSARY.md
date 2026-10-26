# Translation glossary

Each `<tag>.json` here holds one language's text, keyed by the English message id (its English, plus `#description`
when two messages read alike). Whoever adds or changes an English string translates it into every catalogue in the
same change, using the terms below, and runs `npm run i18n:check`.

## Every language

- **Never translated:** Stub, FKN, AniList, MyAnimeList, Crunchyroll, Nyaa, Netflix, Prime Video, JustWatch, IMDb,
  TMDB, Rotten Tomatoes, AnimeThemes, trace.moe, and the format codes TV, OVA, ONA.
- **No em or en dash** (U+2014, U+2013), even where the language's typography uses one: restructure, or use a comma,
  a colon, a plain hyphen or the language's own range mark (`～` in Japanese, `~` in Korean, `至` in Chinese).
- **French and Italian** write the typographic apostrophe `’`.
- **Short labels.** On a 390 px phone a fact's label wraps past 11rem, and the Relations heading and the graph button
  beside it must share one line: the page holds that line's place while sources answer, and a second line moves
  everything under it. The button is a noun phrase in most languages for that reason.
- **Plurals** carry every form the language needs (the check names a missing one): Russian and Polish
  `one, few, many, other`; Japanese, Korean and Chinese `other` alone. A count is written as the English writes it:
  `{count}` as given, never `#`, which groups it (`1.100 Folgen`); the check names a `#` the English lacks.
- **A date range** joins a year or a month alone as often as a day (`1998`, `avr. 1998`, `3 avr. 1998`), so its words
  fit all three: French and Italian write `{start} - {end}`, since du/au and dal/al fit a day alone.

## Register and terms

| | register | episode | a show's season | broadcast season | series (a franchise) | source (adapted from) |
| --- | --- | --- | --- | --- | --- | --- |
| `es-419` | tú, infinitive on buttons | episodio | temporada | Temporada | Franquicia | Obra original |
| `pt-BR` | você, infinitive on buttons | episódio | temporada | Temporada | Franquia | Obra original |
| `fr` | vous, infinitive on buttons | épisode | saison | Saison | Franchise | Œuvre originale |
| `de` | du, infinitive on buttons | Folge | Staffel | Saison | Reihe | Vorlage |
| `it` | tu | episodio | stagione | Stagione | Franchise | Opera originale |
| `ru` | вы | серия | сезон | Сезон | Франшиза | Первоисточник |
| `ja` | です・ます where a sentence is needed | 話 (a count), エピソード | シーズン | 放送時期 | シリーズ | 原作 |
| `ko` | 해요체 where a sentence is needed | 화 (a count), 에피소드 | 시즌 | 방영 분기 | 시리즈 | 원작 |
| `zh-Hans` | 你 | 集 | 季 | 季度 | 系列 | 原作 |
| `zh-Hant` | 你 | 集 | 季 | 季度 | 系列 | 原作 |
| `tr` | siz | bölüm | sezon | Sezon | Seri | Kaynak eser |
| `pl` | ty, or impersonal | odcinek | sezon | Sezon | Seria | Pierwowzór |
