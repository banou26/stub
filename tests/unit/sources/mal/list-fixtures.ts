// MyAnimeList's own answers, for the tests. RECORDED unless marked HAND-MADE:
//
// - The rows are copied verbatim from `/animelist/Xinil/load.json?status=7&order=1&offset=0`, recorded
//   2026-09-29 signed out (a public list).
// - The 400 body is what `/animelist/<a user that does not exist>/load.json` answered that day.
// - The about.php lines are copied verbatim from `https://myanimelist.net/about.php`, signed out, that day:
//   its line 18, its header line 109 and its lines 625 to 635.
//
// - The hover card is `https://myanimelist.net/includes/ajax.inc.php?t=64&id=1` as it answered that day,
//   signed out, whole (978 bytes).
//
// HAND-MADE, because no MyAnimeList account was used: a rewatching row, a signed-in USER_NAME line, and
// every answer to a write. The tests never read a write answer's body.

/** status 2 (Completed), score 10, is_rewatching "". */
export const COWBOY_BEBOP = {
  "status": 2,
  "score": 10,
  "tags": "action, adventure, comedy, space",
  "is_rewatching": "",
  "num_watched_episodes": 26,
  "created_at": 0,
  "updated_at": 1249947791,
  "anime_title": "Cowboy Bebop",
  "anime_title_eng": "Cowboy Bebop",
  "anime_num_episodes": 26,
  "anime_airing_status": 2,
  "anime_id": 1,
  "anime_studios": null,
  "anime_licensors": null,
  "anime_season": null,
  "anime_total_members": 2088837,
  "anime_total_scores": 1076891,
  "anime_score_val": 8.75,
  "anime_score_diff": 1.25,
  "anime_popularity": 41,
  "has_episode_video": false,
  "has_promotion_video": true,
  "has_video": true,
  "video_url": "/anime/1/Cowboy_Bebop/video",
  "genres": [
    {
      "id": 1,
      "name": "Action"
    },
    {
      "id": 46,
      "name": "Award Winning"
    },
    {
      "id": 24,
      "name": "Sci-Fi"
    }
  ],
  "demographics": [],
  "title_localized": null,
  "anime_url": "/anime/1/Cowboy_Bebop",
  "anime_image_path": "https://cdn.myanimelist.net/r/192x272/images/anime/4/19644.jpg?s=aa40e14c009147bfdd64e4ac10692b3b",
  "is_added_to_list": false,
  "anime_media_type_string": "TV",
  "anime_mpaa_rating_string": "R",
  "start_date_string": "01-03-02",
  "finish_date_string": "01-17-02",
  "anime_start_date_string": "04-03-98",
  "anime_end_date_string": "04-24-99",
  "days_string": 15,
  "storage_string": "DVD 3.0",
  "priority_string": "Low",
  "notes": "Best...characters...ever.",
  "editable_notes": "Best...characters...ever."
}

/** status 1 (Watching), 623 watched, anime_num_episodes 0 (still airing). */
export const ONE_PIECE = {
  "status": 1,
  "score": 9,
  "tags": "action, adventure, pirates, comedy",
  "is_rewatching": 0,
  "num_watched_episodes": 623,
  "created_at": 0,
  "updated_at": 1618868682,
  "anime_title": "One Piece",
  "anime_title_eng": "One Piece",
  "anime_num_episodes": 0,
  "anime_airing_status": 1,
  "anime_id": 21,
  "anime_studios": null,
  "anime_licensors": null,
  "anime_season": null,
  "anime_total_members": 2731619,
  "anime_total_scores": 1559787,
  "anime_score_val": 8.72,
  "anime_score_diff": 0.28,
  "anime_popularity": 17,
  "has_episode_video": false,
  "has_promotion_video": true,
  "has_video": true,
  "video_url": "/anime/21/One_Piece/video",
  "genres": [
    {
      "id": 1,
      "name": "Action"
    },
    {
      "id": 2,
      "name": "Adventure"
    },
    {
      "id": 10,
      "name": "Fantasy"
    }
  ],
  "demographics": [
    {
      "id": 27,
      "name": "Shounen"
    }
  ],
  "title_localized": null,
  "anime_url": "/anime/21/One_Piece",
  "anime_image_path": "https://cdn.myanimelist.net/r/192x272/images/anime/1244/138851.jpg?s=efa0bb34987933dc15f7869a6049838d",
  "is_added_to_list": false,
  "anime_media_type_string": "TV",
  "anime_mpaa_rating_string": "PG-13",
  "start_date_string": "09-21-03",
  "finish_date_string": null,
  "anime_start_date_string": "10-20-99",
  "anime_end_date_string": null,
  "days_string": 8410,
  "storage_string": "HD 0.0 Gb",
  "priority_string": "Low",
  "notes": "",
  "editable_notes": ""
}

/** status 2, score 7. */
export const HACK_SIGN = {
  "status": 2,
  "score": 7,
  "tags": "fantasy, adventure",
  "is_rewatching": 0,
  "num_watched_episodes": 26,
  "created_at": 0,
  "updated_at": 1173289779,
  "anime_title": ".hack//Sign",
  "anime_title_eng": ".hack//Sign",
  "anime_num_episodes": 26,
  "anime_airing_status": 2,
  "anime_id": 48,
  "anime_studios": null,
  "anime_licensors": null,
  "anime_season": null,
  "anime_total_members": 196798,
  "anime_total_scores": 88177,
  "anime_score_val": 6.95,
  "anime_score_diff": 0.05,
  "anime_popularity": 1442,
  "has_episode_video": false,
  "has_promotion_video": true,
  "has_video": true,
  "video_url": "/anime/48/hack__Sign/video",
  "genres": [
    {
      "id": 2,
      "name": "Adventure"
    },
    {
      "id": 10,
      "name": "Fantasy"
    },
    {
      "id": 7,
      "name": "Mystery"
    }
  ],
  "demographics": [],
  "title_localized": null,
  "anime_url": "/anime/48/hack__Sign",
  "anime_image_path": "https://cdn.myanimelist.net/r/192x272/images/anime/1443/94665.jpg?s=119e8206049285586560610ddf7363ab",
  "is_added_to_list": false,
  "anime_media_type_string": "TV",
  "anime_mpaa_rating_string": "PG-13",
  "start_date_string": "10-18-02",
  "finish_date_string": "10-27-02",
  "anime_start_date_string": "04-04-02",
  "anime_end_date_string": "09-26-02",
  "days_string": 10,
  "storage_string": "",
  "priority_string": "Low",
  "notes": "",
  "editable_notes": ""
}

/** status 2, score 0 (no score). */
export const CLANNAD = {
  "status": 2,
  "score": 0,
  "tags": "comedy, slice of life, harem, romance",
  "is_rewatching": 0,
  "num_watched_episodes": 23,
  "created_at": 1178608402,
  "updated_at": 1461687833,
  "anime_title": "Clannad",
  "anime_title_eng": "Clannad",
  "anime_num_episodes": 23,
  "anime_airing_status": 2,
  "anime_id": 2167,
  "anime_studios": null,
  "anime_licensors": null,
  "anime_season": null,
  "anime_total_members": 1530259,
  "anime_total_scores": 804882,
  "anime_score_val": 7.99,
  "anime_score_diff": -99,
  "anime_popularity": 95,
  "has_episode_video": false,
  "has_promotion_video": true,
  "has_video": true,
  "video_url": "/anime/2167/Clannad/video",
  "genres": [
    {
      "id": 8,
      "name": "Drama"
    },
    {
      "id": 22,
      "name": "Romance"
    }
  ],
  "demographics": [],
  "title_localized": null,
  "anime_url": "/anime/2167/Clannad",
  "anime_image_path": "https://cdn.myanimelist.net/r/192x272/images/anime/1804/95033.jpg?s=9935a4bd31ed33d7dc1003fc415010c4",
  "is_added_to_list": false,
  "anime_media_type_string": "TV",
  "anime_mpaa_rating_string": "PG-13",
  "start_date_string": "10-21-07",
  "finish_date_string": "10-30-07",
  "anime_start_date_string": "10-05-07",
  "anime_end_date_string": "03-28-08",
  "days_string": 10,
  "storage_string": "DVD 1.0",
  "priority_string": "Low",
  "notes": "",
  "editable_notes": ""
}

/** status 3 (On-Hold), notes carrying an HTML entity. */
export const BLEACH = {
  "status": 3,
  "score": 9,
  "tags": "super-power, action, shounen",
  "is_rewatching": 0,
  "num_watched_episodes": 157,
  "created_at": 0,
  "updated_at": 1453271251,
  "anime_title": "Bleach",
  "anime_title_eng": "Bleach",
  "anime_num_episodes": 366,
  "anime_airing_status": 2,
  "anime_id": 269,
  "anime_studios": null,
  "anime_licensors": null,
  "anime_season": null,
  "anime_total_members": 2254196,
  "anime_total_scores": 1286087,
  "anime_score_val": 8,
  "anime_score_diff": 1,
  "anime_popularity": 32,
  "has_episode_video": false,
  "has_promotion_video": true,
  "has_video": true,
  "video_url": "/anime/269/Bleach/video",
  "genres": [
    {
      "id": 1,
      "name": "Action"
    },
    {
      "id": 2,
      "name": "Adventure"
    },
    {
      "id": 37,
      "name": "Supernatural"
    }
  ],
  "demographics": [
    {
      "id": 27,
      "name": "Shounen"
    }
  ],
  "title_localized": null,
  "anime_url": "/anime/269/Bleach",
  "anime_image_path": "https://cdn.myanimelist.net/r/192x272/images/anime/1541/147774.jpg?s=2eeabe02c547f8a8a136820d38e01551",
  "is_added_to_list": false,
  "anime_media_type_string": "TV",
  "anime_mpaa_rating_string": "PG-13",
  "start_date_string": "10-11-04",
  "finish_date_string": null,
  "anime_start_date_string": "10-05-04",
  "anime_end_date_string": "03-27-12",
  "days_string": 8024,
  "storage_string": "HD 5.0 Gb",
  "priority_string": "Medium",
  "notes": "Fillers stopped at episode 109. Started up again at 110. Stopped again at 129...stupid fillers&#039;.",
  "editable_notes": "Fillers stopped at episode 109. Started up again at 110. Stopped again at 129...stupid fillers'."
}

/** status 4 (Dropped), notes with a <br />. */
export const AIR_GEAR = {
  "status": 4,
  "score": 6,
  "tags": "",
  "is_rewatching": 0,
  "num_watched_episodes": 18,
  "created_at": 0,
  "updated_at": 1201551059,
  "anime_title": "Air Gear",
  "anime_title_eng": "Air Gear",
  "anime_num_episodes": 25,
  "anime_airing_status": 2,
  "anime_id": 857,
  "anime_studios": null,
  "anime_licensors": null,
  "anime_season": null,
  "anime_total_members": 375835,
  "anime_total_scores": 187165,
  "anime_score_val": 7.48,
  "anime_score_diff": -1.48,
  "anime_popularity": 745,
  "has_episode_video": false,
  "has_promotion_video": true,
  "has_video": true,
  "video_url": "/anime/857/Air_Gear/video",
  "genres": [
    {
      "id": 30,
      "name": "Sports"
    },
    {
      "id": 9,
      "name": "Ecchi"
    }
  ],
  "demographics": [
    {
      "id": 27,
      "name": "Shounen"
    }
  ],
  "title_localized": null,
  "anime_url": "/anime/857/Air_Gear",
  "anime_image_path": "https://cdn.myanimelist.net/r/192x272/images/anime/11/18227.jpg?s=028d31f903616df741a45bd314f8c37d",
  "is_added_to_list": false,
  "anime_media_type_string": "TV",
  "anime_mpaa_rating_string": "R+",
  "start_date_string": "08-04-06",
  "finish_date_string": null,
  "anime_start_date_string": "04-05-06",
  "anime_end_date_string": "09-27-06",
  "days_string": 7362,
  "storage_string": "HD 0.0 Gb",
  "priority_string": "Low",
  "notes": "<br />\nDownloaded Episodes: 3",
  "editable_notes": "\nDownloaded Episodes: 3"
}

/** status 6 (Plan to Watch), start and finish dates null. */
export const A_CHANNEL = {
  "status": 6,
  "score": 0,
  "tags": "",
  "is_rewatching": 0,
  "num_watched_episodes": 0,
  "created_at": 1432768982,
  "updated_at": 1432768982,
  "anime_title": "A-Channel",
  "anime_title_eng": "A-Channel",
  "anime_num_episodes": 12,
  "anime_airing_status": 2,
  "anime_id": 9776,
  "anime_studios": null,
  "anime_licensors": null,
  "anime_season": null,
  "anime_total_members": 105738,
  "anime_total_scores": 46317,
  "anime_score_val": 6.94,
  "anime_score_diff": -99,
  "anime_popularity": 2363,
  "has_episode_video": false,
  "has_promotion_video": false,
  "has_video": false,
  "video_url": "/anime/9776/A-Channel/video",
  "genres": [
    {
      "id": 4,
      "name": "Comedy"
    }
  ],
  "demographics": [],
  "title_localized": null,
  "anime_url": "/anime/9776/A-Channel",
  "anime_image_path": "https://cdn.myanimelist.net/r/192x272/images/anime/1333/110595.jpg?s=e514e948630af281349315930bd38931",
  "is_added_to_list": false,
  "anime_media_type_string": "TV",
  "anime_mpaa_rating_string": "PG-13",
  "start_date_string": null,
  "finish_date_string": null,
  "anime_start_date_string": "04-08-11",
  "anime_end_date_string": "06-24-11",
  "days_string": null,
  "storage_string": "",
  "priority_string": "Low",
  "notes": "",
  "editable_notes": ""
}

export const ROWS = [COWBOY_BEBOP, ONE_PIECE, HACK_SIGN, CLANNAD, BLEACH, AIR_GEAR, A_CHANNEL]

/** HAND-MADE: Cowboy Bebop while being rewatched, which MyAnimeList keeps as status 2 with the flag set. */
export const COWBOY_BEBOP_REWATCHING = { ...COWBOY_BEBOP, is_rewatching: 1, num_watched_episodes: 3, updated_at: 1790000000 }

/** The 400 MyAnimeList answers a list read of a user that does not exist. */
export const ERRORS_400 = "{\"errors\":[{\"message\":\"invalid request\"}]}"

/** about.php line 18, signed out: the CSRF token, rendered for a guest too. */
export const ABOUT_CSRF_LINE = "<meta name='csrf_token' content='0f9d61e1cb561a5d581cd53c0db5f26d0cf4f559'>"

/** about.php line 109, signed out: the header with its Login link. */
export const ABOUT_HEADER_LINE = "             href=\"https://myanimelist.net/membership?_location=mal_h_u\" onClick=\"ga_mal_banner()\">Hide Ads</a><a class=\"btn-login\" href=\"https://myanimelist.net/login.php?from=%2Fabout.php\" id=\"malLogin\" onClick=\"ga_notlogin()\">Login</a><a class=\"btn-signup\" href=\"https://myanimelist.net/register.php?from=%2Fabout.php\" onClick=\"ga_registration()\">Sign Up</a></div></div><a href=\"/\" class=\"link-mal-logo\">MyAnimeList.net</a></div>"

/** about.php lines 625 to 635, signed out: USER_NAME names nobody, and has no semicolon. */
export const ABOUT_USER_LINES = "<script type=\"text/javascript\">\n  window.MAL.SLVK = \"g4OvMLVOmEI3J8u7dt8f8+mAuualsqCo\";\n  window.MAL.CDN_URL = \"https://cdn.myanimelist.net\";\n\n  window.MAL.CURRENT_TUTORIAL_STEP_ID = null;\n  window.MAL.USER_NAME = \"\"\n  window.MAL.FACEBOOK.APP_ID = \"360769957454434\"\n  window.MAL.FACEBOOK.API_VERSION = \"v2.12\"\n  \n  window.MAL.GTM_ID = \"WL4QW3G\"\n"

/** The three recorded about.php excerpts as one page, signed out. */
export const ABOUT_SIGNED_OUT = [ABOUT_CSRF_LINE, ABOUT_HEADER_LINE, ABOUT_USER_LINES].join('\n')

/** HAND-MADE: the same page for a signed-in viewer called `viewer`. */
export const ABOUT_SIGNED_IN = ABOUT_SIGNED_OUT
  .replace('window.MAL.USER_NAME = ""', 'window.MAL.USER_NAME = "viewer"')
  .replace(/<a class="btn-login"[^>]*>Login<\/a>/, '')

/** Cowboy Bebop's hover card, the page the session frame holds: `Episodes:</span> 26`. */
export const COWBOY_BEBOP_CARD = "\n\t\t<a href=\"https://myanimelist.net/anime/1/Cowboy_Bebop\" class=\"hovertitle\">Cowboy Bebop (1998)</a></div>\n\t\t<div style=\"margin-top: 8px; margin-bottom: 10px;\">Crime is timeless. By the year 2071, humanity has expanded across the galaxy, filling the surface of other planets with settlements like those on Earth. These new societies are plagued by murder, drug... <a href=\"https://myanimelist.net/anime/1/Cowboy_Bebop\">read more</a></div>\n\t\t<span class=\"dark_text\">Genres:</span> Action, Adult Cast, Award Winning, Sci-Fi, Space<br />\n\t\t<span class=\"dark_text\">Status:</span> Finished Airing<br />\n\t\t<span class=\"dark_text\">Type:</span> TV<br />\n\t\t<span class=\"dark_text\">Episodes:</span> 26<br />\n            <span class=\"dark_text\">Score:</span> 8.75 <small>(scored by 1,076,891 users)</small><br />\n            <span class=\"dark_text\">Ranked:</span> #50<br />\n\t\t<span class=\"dark_text\">Popularity:</span> #41<br />\n\t\t<span class=\"dark_text\">Members:</span> 2,088,837<br />\n\t\t"

/** HAND-MADE: the same card for an anime counting `episodes`, which may be MyAnimeList's `Unknown`. */
export const cardOf = (episodes: number | string) => COWBOY_BEBOP_CARD.replace('Episodes:</span> 26', `Episodes:</span> ${episodes}`)
