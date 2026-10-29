# Translation glossary

Each `<tag>.json` here holds one language's text, keyed by the English message id (its English, plus `#description`
when two messages read alike). Whoever adds or changes an English string translates it into every catalogue in the
same change, using the terms below, and runs `npm run i18n:check`.

## Every language

- **Never translated:** Stub, FKN, AniList, MyAnimeList, Crunchyroll, Nyaa, Netflix, Prime Video, JustWatch, IMDb,
  TMDB, Rotten Tomatoes, AnimeThemes, trace.moe, and the format codes TV, OVA, ONA.
- **No em or en dash** (U+2014, U+2013), even where the language's typography uses one: restructure, or use a comma,
  a colon, a plain hyphen or the language's own range mark (`～` in Japanese, `~` in Korean, `至` in Chinese).
- **French and Italian** write the typographic apostrophe `’`. French puts a no-break space (U+00A0) before `?` and `:`.
- **Japanese and Chinese** put a space between their own text and a Latin name (`{name} にサインインしました。`,
  `已登录 {name}。`), none beside full-width punctuation and none beside a number (`{count}件のソース`, `共{count}集`).
  Korean and Turkish add no particle or suffix that changes with the name: `{name}에`, `{name} hesabına`.
- **Short labels.** On a 390 px phone a fact's label wraps past 11rem, and the Relations heading and the graph button
  beside it must share one line: the page holds that line's place while sources answer, and a second line moves
  everything under it. The button is a noun phrase in most languages for that reason.
- **Plurals** carry every form the language needs (the check names a missing one): Russian and Polish
  `one, few, many, other`; Japanese, Korean and Chinese `other` alone. A count is written as the English writes it:
  `{count}` as given, never `#` or `{count, number}`, which group it (`1.100 Folgen`); the check names either form
  where the English lacks it.
- **A date range** joins a year or a month alone as often as a day (`1998`, `avr. 1998`, `3 avr. 1998`), so its words
  fit all three: French and Italian write `{start} - {end}`, since du/au and dal/al fit a day alone.
- **A value Intl writes** (`{countdown}` is `2 Tage, 3 Stunden`, `{day}` a year, a month or a day) comes in the
  nominative, so the words around it ask no case of it: German `noch {countdown}` and `Bis Folge {episode}:` where
  `in` would want `Tagen`, Polish `jeszcze {countdown}` where `za` would want `godzinę`, and a colon before `{day}`.

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

## Settings

A source is a site or package stub reads or plays. On the cloud a site is signed in to and out of; with the extension
stub only connects to the browser's own session, so its words differ from signing in.

| | source | sign in, sign out | connect, disconnect (extension) | play order | merge order |
| --- | --- | --- | --- | --- | --- |
| `es-419` | fuente | Iniciar sesión, Cerrar sesión | Conectar, Desconectar | Orden de reproducción | Orden de fusión |
| `pt-BR` | fonte | Entrar, Sair | Conectar, Desconectar | Ordem de reprodução | Ordem de mesclagem |
| `fr` | source | Se connecter, Se déconnecter | Associer, Dissocier | Ordre de lecture | Ordre de fusion |
| `de` | Quelle | Anmelden, Abmelden | Verbinden, Trennen | Wiedergabereihenfolge | Reihenfolge beim Zusammenführen |
| `it` | fonte | Accedi, Esci | Collega, Scollega | Ordine di riproduzione | Ordine di unione |
| `ru` | источник | Войти, Выйти | Подключить, Отключить | Порядок воспроизведения | Порядок объединения |
| `ja` | ソース | サインイン, サインアウト | 接続, 接続解除 | 再生の順序 | 統合の順序 |
| `ko` | 소스 | 로그인, 로그아웃 | 연결, 연결 해제 | 재생 순서 | 병합 순서 |
| `zh-Hans` | 来源 | 登录, 退出登录 | 连接, 断开连接 | 播放顺序 | 合并顺序 |
| `zh-Hant` | 來源 | 登入, 登出 | 連線, 中斷連線 | 播放順序 | 合併順序 |
| `tr` | kaynak | Oturum aç, Oturumu kapat | Bağla, Bağlantıyı kes | Oynatma sırası | Birleştirme sırası |
| `pl` | źródło | Zaloguj się, Wyloguj się | Połącz, Rozłącz | Kolejność odtwarzania | Kolejność scalania |

## Watching

| | Continue (resume watching) | Rewatch | Watched (how far) |
| --- | --- | --- | --- |
| `es-419` | Continuar | Volver a ver | Visto |
| `pt-BR` | Continuar | Assistir de novo | Assistido |
| `fr` | Reprendre | Revoir | Visionné |
| `de` | Weiterschauen | Erneut ansehen | Gesehen |
| `it` | Riprendi | Riguarda | Visto |
| `ru` | Продолжить | Пересмотреть | Просмотрено |
| `ja` | 続きから再生 | もう一度見る | 視聴進捗 |
| `ko` | 이어 보기 | 다시 보기 | 시청 진행률 |
| `zh-Hans` | 继续观看 | 重新观看 | 观看进度 |
| `zh-Hant` | 繼續觀看 | 重新觀看 | 觀看進度 |
| `tr` | Devam et | Yeniden izle | İzlendi |
| `pl` | Kontynuuj | Obejrzyj ponownie | Obejrzano |
