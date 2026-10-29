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
  So does a label another message gives, such as a chip's `{filter}` (`Зима`, `Komedia`): Russian `Убрать фильтр
  «{filter}»` and Polish `Usuń filtr „{filter}”`, where the verb alone would want `Зиму` and `Komedię`.

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

## Watch page and players

A release is one of a source's files for an episode (a torrent, a listing). The sign-in window is the one FKN opens,
the pop-up the browser's own. A source is named as in Settings: Browse sources is the same button. An episode's short
label, `E{number} - {title}`, keeps the mark streaming services write in the language (É, E), else the word.

| | release | player | sign-in window | pop-up | Retry | `E{number} - {title}` |
| --- | --- | --- | --- | --- | --- | --- |
| `es-419` | versión | reproductor | ventana de inicio de sesión | ventana emergente | Reintentar | `E{number} - {title}` |
| `pt-BR` | versão | player | janela de login | pop-up | Tentar novamente | `E{number} - {title}` |
| `fr` | version | lecteur | fenêtre de connexion | fenêtre pop-up | Réessayer | `É{number} - {title}` |
| `de` | Release | Player | Anmeldefenster | Pop-up | Erneut versuchen | `Folge {number} - {title}` |
| `it` | versione | player | finestra di accesso | pop-up | Riprova | `E{number} - {title}` |
| `ru` | релиз | плеер | окно входа | всплывающее окно | Повторить | `Серия {number} - {title}` |
| `ja` | リリース | プレーヤー | サインイン画面 | ポップアップ | 再試行 | `第{number}話 {title}` |
| `ko` | 릴리스 | 플레이어 | 로그인 창 | 팝업 | 다시 시도 | `{number}화 {title}` |
| `zh-Hans` | 版本 | 播放器 | 登录窗口 | 弹出窗口 | 重试 | `第{number}集 {title}` |
| `zh-Hant` | 版本 | 播放器 | 登入視窗 | 彈出式視窗 | 重試 | `第{number}集 {title}` |
| `tr` | sürüm | oynatıcı | oturum açma penceresi | açılır pencere | Tekrar dene | `{number}. Bölüm - {title}` |
| `pl` | wydanie | odtwarzacz | okno logowania | wyskakujące okno | Spróbuj ponownie | `Odc. {number} - {title}` |

## Watch together

A party is a few viewers watching together: the host steers, the others follow and may be given controls. A chat line
about a member's action is written by each viewer's app in its own language, from the action and its values, so it
names the member as `{member}` and the viewer by the `self` branch. Where a past tense would agree with the member's
gender (Russian, Polish), the line is the member and a noun: `{member}: пауза`. Korean writes `{member} 님이` and
`{track}(으)로`, whose particle no name changes. A host with no name is `host` as a label (a badge, who said a
line) and a message of its own as who did what a line says, which takes the article: `der Host`, `l’hôte`,
`el anfitrión`, `l’host`, `o anfitrião`. The grants' first row, All followers, shares the menu's width with six
controls, so it is one word where the language's phrase runs long: `Alle`, `Todos`, `Tous`, `Все`.

| | Watch together | party | host | the others | Catch up | Follow playback |
| --- | --- | --- | --- | --- | --- | --- |
| `es-419` | Ver juntos | grupo | anfitrión | participantes | Sincronizar | Seguir la reproducción |
| `pt-BR` | Assistir juntos | grupo | anfitrião | participantes | Sincronizar | Acompanhar a reprodução |
| `fr` | Regarder ensemble | groupe | hôte | participants | Rattraper | Suivre la lecture |
| `de` | Gemeinsam schauen | Party | Host | Teilnehmende | Aufholen | Wiedergabe folgen |
| `it` | Guarda insieme | gruppo | host | partecipanti | Sincronizza | Segui la riproduzione |
| `ru` | Смотреть вместе | комната | ведущий | участники | Догнать | Следовать за воспроизведением |
| `ja` | 一緒に見る | パーティー | ホスト | 参加者 | 追いつく | ホストの再生に合わせる |
| `ko` | 함께 보기 | 파티 | 호스트 | 참여자 | 따라잡기 | 호스트 재생 따라가기 |
| `zh-Hans` | 一起看 | 派对 | 主持人 | 成员 | 同步进度 | 跟随主持人播放 |
| `zh-Hant` | 一起看 | 派對 | 主持人 | 成員 | 同步進度 | 跟隨主持人播放 |
| `tr` | Birlikte izle | parti | ev sahibi | katılımcılar | Eşitle | Oynatmayı takip et |
| `pl` | Oglądaj razem | sesja | prowadzący | uczestnicy | Synchronizuj | Śledź odtwarzanie |

## Header and search

The four sites are named by what they keep, the words of home's category tabs and the search page's Category: Movies,
Series (TV shows), Anime, and All for stub.fkn.app. A season and its year (`Fall 2026`) and every year's season (`Fall seasons`) are a
message per season, never a season name joined to a year, so each language orders and builds them its own way
(`2026年秋`, `Herbstsaisons`). Genres keep the word the language's own streaming sites use; AniList's anime words stay
as fans write them where the language has none (Ecchi, Mahou Shoujo, Mecha). The FKN account's Disconnect is its own
message, as French says `Se déconnecter` where the extension's `Dissocier` would not fit an account. On a 390 px phone
the search page's title field is half the width, and a field clips its placeholder silently, so `Any title` is a word or
two (`Titel`, `タイトル`). The genre picker's filter box holds 11 Japanese characters at most (`ジャンル・タグ絞り込み`).

| | search | Series (TV shows) | filter, clear filters | Any (nothing picked) | airing status |
| --- | --- | --- | --- | --- | --- |
| `es-419` | Buscar | Series | Filtrar, Borrar filtros | Cualquiera | Estado de emisión |
| `pt-BR` | Buscar | Séries | Filtrar, Limpar filtros | Qualquer | Status de exibição |
| `fr` | Rechercher | Séries | Filtrer, Effacer les filtres | Tous | Statut de diffusion |
| `de` | Suche | Serien | filtern, Filter zurücksetzen | Beliebig | Sendestatus |
| `it` | Cerca | Serie | Filtra, Cancella filtri | Qualsiasi | Stato di trasmissione |
| `ru` | Поиск | Сериалы | Фильтр, Сбросить фильтры | Любой | Статус выхода |
| `ja` | 検索 | テレビ番組 | 絞り込む, フィルターをクリア | 指定なし | 放送状況 |
| `ko` | 검색 | TV 시리즈 | 필터, 필터 초기화 | 전체 | 방영 상태 |
| `zh-Hans` | 搜索 | 电视剧 | 筛选, 清除筛选 | 不限 | 播出状态 |
| `zh-Hant` | 搜尋 | 影集 | 篩選, 清除篩選 | 不限 | 播出狀態 |
| `tr` | Ara | Diziler | filtrele, Filtreleri temizle | Tümü | Yayın durumu |
| `pl` | Szukaj | Seriale | Filtruj, Wyczyść filtry | Dowolne | Status emisji |
