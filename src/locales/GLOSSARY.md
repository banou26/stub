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
  everything under it. The button is a noun phrase in every language for that reason.
- **Plurals** carry every form the language needs (the check names a missing one): Russian and Polish
  `one, few, many, other`, and Ukrainian too; Czech and Romanian `one, few, other`; Japanese, Korean, Chinese,
  Indonesian, Malay, Vietnamese and Thai `other` alone; Hindi `one, other`, its `one` taking 0 as well; Arabic
  `zero, one, two, few, many, other`; Hebrew `one, two, other`. Romanian puts `de` before a noun from 20 on
  (`{count} de episoade`), and Hungarian keeps the noun singular after a number (`{count} rész`). Arabic and Hebrew write one and two in words (`حلقة واحدة`, `حلقتان`, `פרק אחד`,
  `שני פרקים`), so their `one` and `two` branches hold no `{count}`. A count is written as the English writes it:
  `{count}` as given, never `#` or `{count, number}`, which group it (`1.100 Folgen`); the check names either form
  where the English lacks it.
- **A date range** joins a year or a month alone as often as a day (`1998`, `avr. 1998`, `3 avr. 1998`), so its words
  fit all three: French and Italian write `{start} - {end}`, since du/au and dal/al fit a day alone.
- **A value Intl writes** (`{countdown}` is `2 Tage, 3 Stunden`, `{day}` a year, a month or a day) comes in the
  nominative, so the words around it ask no case of it: German `noch {countdown}` and `Bis Folge {episode}:` where
  `in` would want `Tagen`, Polish `jeszcze {countdown}` where `za` would want `godzinę`, and a colon before `{day}`.
  So does a label another message gives, such as a chip's `{filter}` (`Зима`, `Komedia`): Russian `Убрать фильтр
  «{filter}»` and Polish `Usuń filtr „{filter}”`, where the verb alone would want `Зиму` and `Komedię`.

- **Arabic and Hebrew** read right to left, and `src/i18n` isolates each plain value at load, so a catalogue holds no
  direction mark. Brand names stay in Latin script, and a prefix joins one the way the language writes it: Arabic
  `لـ {name}` and `بـ {name}`, Hebrew `ב-{name}` and `מ-{name}`. Arabic writes its own comma and question mark (`،`, `؟`)
  and guillemets (`«{term}»`), Hebrew gershayim (`״{term}״`) and geresh in loanwords (`צ׳אט`, `ז׳אנרים`). A value beside
  an adjective or a past verb would ask it to agree with a number or a person nobody knows, so the line is a label and a
  colon: `جاهز: {count}`, `מוכנים: {count}`, `{member}: إيقاف مؤقت`, `{member}: השהיה`.
  The isolate splits a value from a Latin letter touching it, so the speed reads `×{rate}` where other languages write
  `{rate}x`, and the version `الإصدار {version}`, `גרסה {version}`. A format's name leads with the language's own letters
  (`مسلسل TV قصير`, `סדרת TV קצרה`), since a fact's value takes its direction from its first letter.

- **Wave 2.** A value takes no case ending: Hungarian writes it after a colon or in parentheses (`Mentés ide: {name}`,
  `A mentés nem sikerült ({name})`), since a suffix would follow the value's own vowels. A past verb beside
  `{member}` would agree with a gender nobody knows in Ukrainian and Czech, so their chat lines are a label and a
  colon as Russian's are (`{member}: пауза`, `{member}: pauza`); Hindi's `ने` form agrees with the object instead
  (`{member} ने रोका`). Thai ends a sentence with no full stop and parts clauses with a space, Hindi ends one with
  `।`, Greek asks with `;`. Ukrainian writes the apostrophe `’` (`об’єднання`), Romanian the comma-below `ș` and `ț`.
  Indonesian and Malay share words, not a vocabulary: `Masuk` and `Log masuk`, `Subtitel` and `Sari kata`,
  `Pengaturan` and `Tetapan`.

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
| `ar` | imperative in the masculine singular in a sentence, the verbal noun on buttons | حلقة | موسم | الموسم | السلسلة | العمل الأصلي |
| `he` | imperative in the plural in a sentence, the action noun on buttons | פרק | עונה | עונה | זיכיון | יצירת המקור |
| `id` | Anda, the verb's base form on buttons | episode | musim | Musim | Waralaba | Karya asli |
| `ms` | anda, the verb's base form on buttons | episod | musim | Musim | Francais | Karya asal |
| `vi` | bạn | tập | mùa | Mùa | Loạt tác phẩm | Nguyên tác |
| `th` | polite, a pronoun (คุณ) only where needed | ตอน | ซีซัน | ฤดูกาล | แฟรนไชส์ | ต้นฉบับ |
| `hi` | आप, the polite imperative (-ें) on buttons | एपिसोड | सीज़न | सीज़न | फ़्रेंचाइज़ी | मूल रचना |
| `uk` | ви | серія | сезон | Сезон | Франшиза | Першоджерело |
| `nl` | je, infinitive on buttons | aflevering | seizoen | Seizoen | Franchise | Bronmateriaal |
| `sv` | du, imperative on buttons | avsnitt | säsong | Säsong | Franchise | Förlaga |
| `cs` | vy, infinitive on buttons | díl | řada | Sezóna | Franšíza | Předloha |
| `el` | εσείς, the action noun on buttons | επεισόδιο | σεζόν | Περίοδος | Σειρά έργων | Πρωτότυπο έργο |
| `ro` | dumneavoastră, the polite imperative on buttons | episod | sezon | Sezon | Franciză | Opera originală |
| `hu` | te, the action noun on buttons | rész | évad | Szezon | Franchise | Eredeti mű |

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
| `ar` | مصدر | تسجيل الدخول, تسجيل الخروج | ربط, إلغاء الربط | ترتيب التشغيل | ترتيب الدمج |
| `he` | מקור | התחברות, התנתקות | קישור, ביטול קישור | סדר הפעלה | סדר מיזוג |
| `id` | sumber | Masuk, Keluar | Hubungkan, Putuskan | Urutan putar | Urutan penggabungan |
| `ms` | sumber | Log masuk, Log keluar | Sambung, Putuskan | Susunan main | Susunan gabungan |
| `vi` | nguồn | Đăng nhập, Đăng xuất | Kết nối, Ngắt kết nối | Thứ tự phát | Thứ tự hợp nhất |
| `th` | แหล่งที่มา | ลงชื่อเข้าใช้, ออกจากระบบ | เชื่อมต่อ, ยกเลิกการเชื่อมต่อ | ลำดับการเล่น | ลำดับการรวม |
| `hi` | सोर्स | साइन इन करें, साइन आउट करें | कनेक्ट करें, डिसकनेक्ट करें | चलाने का क्रम | मर्ज का क्रम |
| `uk` | джерело | Увійти, Вийти | Під’єднати, Від’єднати | Порядок відтворення | Порядок об’єднання |
| `nl` | bron | Inloggen, Uitloggen | Koppelen, Ontkoppelen | Afspeelvolgorde | Samenvoegvolgorde |
| `sv` | källa | Logga in, Logga ut | Anslut, Koppla från | Uppspelningsordning | Sammanslagningsordning |
| `cs` | zdroj | Přihlásit se, Odhlásit se | Připojit, Odpojit | Pořadí přehrávání | Pořadí slučování |
| `el` | πηγή | Σύνδεση, Αποσύνδεση | Συσχέτιση, Κατάργηση συσχέτισης | Σειρά αναπαραγωγής | Σειρά συγχώνευσης |
| `ro` | sursă | Conectați-vă, Deconectați-vă | Asociați, Disociați | Ordinea de redare | Ordinea de îmbinare |
| `hu` | forrás | Bejelentkezés, Kijelentkezés | Összekapcsolás, Leválasztás | Lejátszási sorrend | Egyesítési sorrend |

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
| `ar` | متابعة | إعادة المشاهدة | المشاهَد |
| `he` | המשך צפייה | צפייה חוזרת | נצפו |
| `id` | Lanjutkan | Tonton ulang | Ditonton |
| `ms` | Sambung tonton | Tonton semula | Ditonton |
| `vi` | Xem tiếp | Xem lại | Đã xem |
| `th` | ดูต่อ | ดูอีกครั้ง | ดูแล้ว |
| `hi` | देखना जारी रखें | फिर से देखें | देखा गया |
| `uk` | Продовжити | Переглянути знову | Переглянуто |
| `nl` | Verder kijken | Opnieuw kijken | Bekeken |
| `sv` | Fortsätt titta | Titta igen | Sett |
| `cs` | Pokračovat | Zhlédnout znovu | Zhlédnuto |
| `el` | Συνέχιση | Ξαναδείτε το | Είδατε |
| `ro` | Continuați | Revedeți | Vizionat |
| `hu` | Folytatás | Újranézés | Megnézve |

## Watch page and players

A release is one of a source's files for an episode (a torrent, a listing). The sign-in window is the one FKN opens,
the pop-up the browser's own. A source is named as in Settings: Browse sources is the same button. An episode's short
label, `E{number} - {title}`, keeps the mark streaming services write in the language (É, E), else the word. A
source card's languages are named by Intl, except Multiple languages (the tag `mul`), which Chrome leaves unnamed: a
noun phrase written in the case the language gives the names around it.

| | release | player | sign-in window | pop-up | Retry | `E{number} - {title}` | Multiple languages |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `es-419` | versión | reproductor | ventana de inicio de sesión | ventana emergente | Reintentar | `E{number} - {title}` | varios idiomas |
| `pt-BR` | versão | player | janela de login | pop-up | Tentar novamente | `E{number} - {title}` | vários idiomas |
| `fr` | version | lecteur | fenêtre de connexion | fenêtre pop-up | Réessayer | `É{number} - {title}` | plusieurs langues |
| `de` | Release | Player | Anmeldefenster | Pop-up | Erneut versuchen | `Folge {number} - {title}` | Mehrere Sprachen |
| `it` | versione | player | finestra di accesso | pop-up | Riprova | `E{number} - {title}` | più lingue |
| `ru` | релиз | плеер | окно входа | всплывающее окно | Повторить | `Серия {number} - {title}` | несколько языков |
| `ja` | リリース | プレーヤー | サインイン画面 | ポップアップ | 再試行 | `第{number}話 {title}` | 複数言語 |
| `ko` | 릴리스 | 플레이어 | 로그인 창 | 팝업 | 다시 시도 | `{number}화 {title}` | 여러 언어 |
| `zh-Hans` | 版本 | 播放器 | 登录窗口 | 弹出窗口 | 重试 | `第{number}集 {title}` | 多种语言 |
| `zh-Hant` | 版本 | 播放器 | 登入視窗 | 彈出式視窗 | 重試 | `第{number}集 {title}` | 多種語言 |
| `tr` | sürüm | oynatıcı | oturum açma penceresi | açılır pencere | Tekrar dene | `{number}. Bölüm - {title}` | Birden fazla dil |
| `pl` | wydanie | odtwarzacz | okno logowania | wyskakujące okno | Spróbuj ponownie | `Odc. {number} - {title}` | wiele języków |
| `ar` | إصدار | المشغّل | نافذة تسجيل الدخول | نافذة منبثقة | إعادة المحاولة | `الحلقة {number} - {title}` | لغات متعددة |
| `he` | גרסה | נגן | חלון ההתחברות | חלון קופץ | ניסיון חוזר | `פרק {number} - {title}` | מספר שפות |
| `id` | rilis | pemutar | jendela masuk | pop-up | Coba lagi | `E{number} - {title}` | beberapa bahasa |
| `ms` | keluaran | pemain | tetingkap log masuk | tetingkap timbul | Cuba lagi | `E{number} - {title}` | pelbagai bahasa |
| `vi` | bản phát hành | trình phát | cửa sổ đăng nhập | cửa sổ bật lên | Thử lại | `Tập {number} - {title}` | nhiều ngôn ngữ |
| `th` | รีลีส | เครื่องเล่น | หน้าต่างลงชื่อเข้าใช้ | ป๊อปอัป | ลองอีกครั้ง | `ตอนที่ {number} - {title}` | หลายภาษา |
| `hi` | रिलीज़ | प्लेयर | साइन इन विंडो | पॉप-अप | फिर से कोशिश करें | `एपिसोड {number} - {title}` | कई भाषाएं |
| `uk` | реліз | плеєр | вікно входу | спливне вікно | Повторити | `Серія {number} - {title}` | кілька мов |
| `nl` | release | speler | inlogvenster | pop-up | Opnieuw proberen | `Afl. {number} - {title}` | meerdere talen |
| `sv` | utgåva | spelare | inloggningsfönster | popup-fönster | Försök igen | `Avs. {number} - {title}` | flera språk |
| `cs` | vydání | přehrávač | přihlašovací okno | vyskakovací okno | Zkusit znovu | `{number}. díl - {title}` | více jazyků |
| `el` | έκδοση | πρόγραμμα αναπαραγωγής | παράθυρο σύνδεσης | αναδυόμενο παράθυρο | Επανάληψη | `Ε{number} - {title}` | πολλές γλώσσες |
| `ro` | versiune | player | fereastra de conectare | fereastră pop-up | Reîncercați | `E{number} - {title}` | mai multe limbi |
| `hu` | kiadás | lejátszó | bejelentkezési ablak | előugró ablak | Újra | `{number}. rész - {title}` | több nyelv |

## Watch party

A party is a few viewers watching together: the host steers, the others follow and may be given controls. A chat line
about a member's action is written by each viewer's app in its own language, from the action and its values, so it
names the member as `{member}` and the viewer by the `self` branch. Where a past tense would agree with the member's
gender (Russian, Polish), the line is the member and a noun: `{member}: пауза`. Korean writes `{member} 님이` and
`{track}(으)로`, whose particle no name changes. A host with no name is `host` as a label (a badge, who said a
line) and a message of its own as who did what a line says, which takes the article: `der Host`, `l’hôte`,
`el anfitrión`, `l’host`, `o anfitrião`. The grants' first row, All followers, shares the menu's width with six
controls, so it is one word where the language's phrase runs long: `Alle`, `Todos`, `Tous`, `Все`. Watch party is the
header's button, renamed from Watch together to take less room, so a language keeps whichever of the two is shorter:
`Watch-Party` in German, the words for watching together everywhere else.

| | Watch party | party | host | the others | Catch up | Follow playback |
| --- | --- | --- | --- | --- | --- | --- |
| `es-419` | Ver juntos | grupo | anfitrión | participantes | Sincronizar | Seguir la reproducción |
| `pt-BR` | Assistir juntos | grupo | anfitrião | participantes | Sincronizar | Acompanhar a reprodução |
| `fr` | Regarder ensemble | groupe | hôte | participants | Rattraper | Suivre la lecture |
| `de` | Watch-Party | Party | Host | Teilnehmende | Aufholen | Wiedergabe folgen |
| `it` | Guarda insieme | gruppo | host | partecipanti | Sincronizza | Segui la riproduzione |
| `ru` | Смотреть вместе | комната | ведущий | участники | Догнать | Следовать за воспроизведением |
| `ja` | 一緒に見る | パーティー | ホスト | 参加者 | 追いつく | ホストの再生に合わせる |
| `ko` | 함께 보기 | 파티 | 호스트 | 참여자 | 따라잡기 | 호스트 재생 따라가기 |
| `zh-Hans` | 一起看 | 派对 | 主持人 | 成员 | 同步进度 | 跟随主持人播放 |
| `zh-Hant` | 一起看 | 派對 | 主持人 | 成員 | 同步進度 | 跟隨主持人播放 |
| `tr` | Birlikte izle | parti | ev sahibi | katılımcılar | Eşitle | Oynatmayı takip et |
| `pl` | Oglądaj razem | sesja | prowadzący | uczestnicy | Synchronizuj | Śledź odtwarzanie |
| `ar` | مشاهدة جماعية | مجموعة | مضيف | المشاركون | مزامنة | متابعة التشغيل |
| `he` | צפייה משותפת | קבוצה | מארח | משתתפים | סנכרון | מעקב אחר ההפעלה |
| `id` | Tonton bersama | grup | host | peserta | Sinkronkan | Ikuti pemutaran |
| `ms` | Tonton bersama | kumpulan | hos | peserta | Segerakkan | Ikut main balik |
| `vi` | Xem chung | nhóm | chủ phòng | thành viên | Bắt kịp | Theo dõi phát |
| `th` | ดูด้วยกัน | ปาร์ตี้ | โฮสต์ | ผู้ร่วมชม | ตามให้ทัน | เล่นตามโฮสต์ |
| `hi` | साथ देखें | पार्टी | होस्ट | सदस्य | सिंक करें | होस्ट के साथ चलाएं |
| `uk` | Дивитися разом | кімната | ведучий | учасники | Наздогнати | Стежити за відтворенням |
| `nl` | Samen kijken | groep | host | deelnemers | Inhalen | Afspelen volgen |
| `sv` | Titta tillsammans | grupp | värd | deltagare | Kom ikapp | Följ uppspelningen |
| `cs` | Sledovat společně | skupina | hostitel | účastníci | Dohnat | Sledovat přehrávání |
| `el` | Κοινή προβολή | ομάδα | οικοδεσπότης | συμμετέχοντες | Συγχρονισμός | Ακολούθηση αναπαραγωγής |
| `ro` | Vizionare împreună | grup | gazdă | participanți | Recuperați | Urmăriți redarea |
| `hu` | Közös nézés | csoport | házigazda | résztvevők | Felzárkózás | Lejátszás követése |

## Header and search

The four sites are named by what they keep, the words of home's category tabs and the search page's Category: Movies,
Series (TV shows), Anime, and All for stub.fkn.app. A season and its year (`Fall 2026`) and every year's season (`Fall seasons`) are a
message per season, never a season name joined to a year, so each language orders and builds them its own way
(`2026年秋`, `Herbstsaisons`). Genres keep the word the language's own streaming sites use; AniList's anime words stay
as fans write them where the language has none (Ecchi, Mahou Shoujo, Mecha). The FKN account's Disconnect is its own
message, as French says `Se déconnecter` where the extension's `Dissocier` would not fit an account. On a 390 px phone
the search page's title field is half the width, and a field clips its placeholder silently, so `Any title` is a word or
two (`Titel`, `タイトル`). The genre picker's filter box holds 11 Japanese characters at most (`ジャンル・タグ絞り込み`).
A card's tag names one title, Movie or Series, so its Series is singular where the tabs' is plural (`Série`, `Сериал`,
`Dizi`), and covers anime too: `シリーズ`, `시리즈` and `剧集` rather than the tabs' TV words.

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
| `ar` | بحث | مسلسلات | تصفية, مسح عوامل التصفية | الكل | حالة العرض |
| `he` | חיפוש | סדרות | סינון, ניקוי המסננים | הכול | סטטוס שידור |
| `id` | Cari | Serial | Filter, Hapus filter | Semua | Status tayang |
| `ms` | Cari | Siri | Tapis, Kosongkan penapis | Semua | Status siaran |
| `vi` | Tìm kiếm | Phim bộ | Lọc, Xóa bộ lọc | Bất kỳ | Tình trạng phát sóng |
| `th` | ค้นหา | ซีรีส์ | กรอง, ล้างตัวกรอง | ทั้งหมด | สถานะการฉาย |
| `hi` | खोजें | सीरीज़ | फ़िल्टर करें, फ़िल्टर हटाएं | कोई भी | प्रसारण की स्थिति |
| `uk` | Пошук | Серіали | Фільтр, Скинути фільтри | Будь-який | Статус виходу |
| `nl` | Zoeken | Series | Filteren, Filters wissen | Alle | Uitzendstatus |
| `sv` | Sök | Serier | Filtrera, Rensa filter | Alla | Sändningsstatus |
| `cs` | Hledat | Seriály | Filtrovat, Vymazat filtry | Libovolné | Stav vysílání |
| `el` | Αναζήτηση | Σειρές | Φιλτράρισμα, Απαλοιφή φίλτρων | Οποιοδήποτε | Κατάσταση προβολής |
| `ro` | Căutați | Seriale | Filtrați, Ștergeți filtrele | Oricare | Stare difuzare |
| `hu` | Keresés | Sorozatok | Szűrés, Szűrők törlése | Bármelyik | Vetítési állapot |

## Tracking

A tracker is a site that keeps the viewer's list (AniList, MyAnimeList, Crunchyroll, Stub), each list holding an entry
per title with a status, a progress and a score. The six statuses are the list's own words, also inside MyAnimeList's
`it as {status, select, ...}`, which reads `the status Watching` in most languages. A tracker that did not save is
named without a verb agreeing with it in Russian and Polish (`Не удалось сохранить в {name}`, `Nie zapisano w
{name}`), since the name's gender is unknown; Korean puts a particle that follows the word before it inside each select
branch (`{kind, select, removal {삭제를} other {저장을}}`). A site's own words in `{said}` and `{error}` come as the site
wrote them. `MyAnimeList shows {shown}` lists messages of their own (the status, `{progress}` episodes, the score or
`no score`), so where the verb would ask a case of them or a negation of itself it ends in a colon and each item reads as
a label (Russian `показывает: 1 серия, оценка 7 / 10`, French `affiche : aucune note`); German and Polish write every
item in the accusative their verb asks. A film's `Watched` toggle sits beside the status and is on exactly when it reads
Completed, so the two are different words (Russian `Смотрели` and `Просмотрено`, Polish `Widziane` and `Obejrzane`).
The status select beside the score is as wide as English `Plan to watch` in Montserrat, 14rem, so `Add to list` and every
status fit it: `Add to list` is the verb alone where the phrase runs longer (`Ajouter`, `Hinzufügen`, `Добавить`), and a
status takes a shorter form (`Erneut sehen`, `Beendet`, `В планах`). German keeps `Abgeschlossen` for an airing
status.

| | tracker | list, entry | score | Watching | Rewatching | Plan to watch | Completed | Paused | Dropped | Quick tracking |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `es-419` | rastreador | lista, entrada | puntuación | Viendo | Reviendo | Por ver | Completado | En pausa | Abandonado | Seguimiento rápido |
| `pt-BR` | rastreador | lista, entrada | nota | Assistindo | Revendo | Para assistir | Completo | Pausado | Abandonado | Acompanhamento rápido |
| `fr` | tracker | liste, entrée | note | En cours | Revisionnage | À voir | Terminé | En pause | Abandonné | Suivi rapide |
| `de` | Tracker | Liste, Eintrag | Bewertung | Am Schauen | Erneut sehen | Geplant | Beendet | Pausiert | Abgebrochen | Schnelles Tracking |
| `it` | tracker | lista, voce | voto | In corso | Rivedendo | Da vedere | Completato | In pausa | Abbandonato | Monitoraggio rapido |
| `ru` | трекер | список, запись | оценка | Смотрю | Пересмотр | В планах | Просмотрено | Отложено | Брошено | Быстрое отслеживание |
| `ja` | トラッカー | リスト、エントリー | スコア | 視聴中 | 再視聴中 | 視聴予定 | 視聴完了 | 一時停止中 | 視聴中止 | クイック記録 |
| `ko` | 트래커 | 목록, 항목 | 점수 | 보는 중 | 다시 보는 중 | 볼 예정 | 완료 | 일시 중지 | 중단 | 빠른 기록 |
| `zh-Hans` | 追踪器 | 列表、条目 | 评分 | 在看 | 重看中 | 想看 | 看过 | 搁置 | 抛弃 | 快速记录 |
| `zh-Hant` | 追蹤器 | 清單、項目 | 評分 | 在看 | 重看中 | 想看 | 看過 | 擱置 | 拋棄 | 快速記錄 |
| `tr` | takip aracı | liste, kayıt | puan | İzleniyor | Yine izleniyor | İzlenecek | Tamamlandı | Ara verildi | Bırakıldı | Hızlı takip |
| `pl` | tracker | lista, wpis | ocena | Oglądam | Powtórka | Planuję | Obejrzane | Wstrzymane | Porzucone | Szybkie śledzenie |
| `ar` | متتبع | قائمة, إدخال | تقييم | أشاهده | أعيد مشاهدته | سأشاهده | مكتمل | متوقف مؤقتًا | متروك | تتبع سريع |
| `he` | כלי מעקב | רשימה, רשומה | ציון | בצפייה | צפייה חוזרת | מתוכנן | הושלם | מושהה | ננטש | מעקב מהיר |
| `id` | pelacak | daftar, entri | skor | Menonton | Ditonton ulang | Akan ditonton | Selesai | Ditunda | Berhenti | Pelacakan cepat |
| `ms` | penjejak | senarai, entri | skor | Menonton | Tonton semula | Akan ditonton | Selesai | Ditangguhkan | Digugurkan | Penjejakan pantas |
| `vi` | trình theo dõi | danh sách, mục | điểm | Đang xem | Đang xem lại | Dự định xem | Đã xem xong | Tạm dừng | Bỏ dở | Theo dõi nhanh |
| `th` | ตัวติดตาม | รายการ | คะแนน | กำลังดู | ดูซ้ำ | วางแผนจะดู | ดูจบแล้ว | พักไว้ | เลิกดู | ติดตามด่วน |
| `hi` | ट्रैकर | लिस्ट, एंट्री | स्कोर | देख रहे हैं | फिर से देख रहे हैं | देखने की योजना | पूरा हुआ | रुका हुआ | छोड़ दिया | क्विक ट्रैकिंग |
| `uk` | трекер | список, запис | оцінка | Дивлюся | Переглядаю | У планах | Переглянуто | Відкладено | Покинуто | Швидке відстеження |
| `nl` | tracker | lijst, item | score | Aan het kijken | Herbekijken | Wil ik zien | Voltooid | Gepauzeerd | Gestopt | Snel bijhouden |
| `sv` | tracker | lista, post | betyg | Tittar | Tittar om | Planerad | Klar | Pausad | Avbruten | Snabbspårning |
| `cs` | tracker | seznam, záznam | hodnocení | Sleduji | Znovu sleduji | Plánuji | Dokončeno | Pozastaveno | Zahozeno | Rychlé sledování |
| `el` | tracker | λίστα, καταχώριση | βαθμολογία | Το βλέπω | Το ξαναβλέπω | Θα το δω | Ολοκληρώθηκε | Σε παύση | Εγκαταλείφθηκε | Γρήγορη καταγραφή |
| `ro` | tracker | listă, intrare | scor | În curs | Revizionare | De văzut | Terminat | În pauză | Abandonat | Urmărire rapidă |
| `hu` | tracker | lista, bejegyzés | pontszám | Nézem | Újranézem | Tervezem | Befejezve | Szüneteltetve | Abbahagyva | Gyors követés |

## Footer, paging and errors

A long list's controls are named after its heading (`{list} pages`), which arrives in the nominative, so German,
Russian and Polish write it after a colon (`Seiten: {list}`). Japanese, Korean and Chinese put the 404 after the words
(`ページが見つかりません（404）`), since a number beside their own text takes no space.

| | Legal | Privacy | page (of a list) | Reload |
| --- | --- | --- | --- | --- |
| `es-419` | Aviso legal | Privacidad | página | Recargar |
| `pt-BR` | Aviso legal | Privacidade | página | Recarregar |
| `fr` | Mentions légales | Confidentialité | page | Recharger |
| `de` | Rechtliches | Datenschutz | Seite | Neu laden |
| `it` | Note legali | Privacy | pagina | Ricarica |
| `ru` | Правовая информация | Конфиденциальность | страница | Перезагрузить |
| `ja` | 法的情報 | プライバシー | ページ | 再読み込み |
| `ko` | 법적 고지 | 개인정보 보호 | 페이지 | 새로고침 |
| `zh-Hans` | 法律声明 | 隐私 | 页 | 重新加载 |
| `zh-Hant` | 法律聲明 | 隱私權 | 頁 | 重新載入 |
| `tr` | Yasal bilgiler | Gizlilik | sayfa | Yeniden yükle |
| `pl` | Informacje prawne | Prywatność | strona | Odśwież |
| `id` | Informasi hukum | Privasi | halaman | Muat ulang |
| `ms` | Notis undang-undang | Privasi | halaman | Muat semula |
| `vi` | Pháp lý | Quyền riêng tư | trang | Tải lại |
| `th` | ข้อกฎหมาย | ความเป็นส่วนตัว | หน้า | โหลดซ้ำ |
| `hi` | कानूनी जानकारी | निजता | पेज | फिर से लोड करें |
| `uk` | Правова інформація | Конфіденційність | сторінка | Перезавантажити |
| `nl` | Juridisch | Privacy | pagina | Opnieuw laden |
| `sv` | Juridisk information | Integritet | sida | Läs in igen |
| `cs` | Právní informace | Soukromí | stránka | Načíst znovu |
| `el` | Νομικά | Απόρρητο | σελίδα | Επαναφόρτωση |
| `ro` | Informații juridice | Confidențialitate | pagină | Reîncărcați |
| `hu` | Jogi információk | Adatvédelem | oldal | Újratöltés |
