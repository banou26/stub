import { describe, expect, test } from 'vite-plus/test'

import { parseSauceNaoHtml } from '../../../src/scene/saucenao-parse'

// Captured from live `POST https://saucenao.com/search.php` with a real Frieren ep 1 frame.
const FRIEREN_HTML = `
<div id="middle">
  <div class="result">
    <table class="resulttable">
      <tr>
        <td class="resulttablecontent">
          <div class="resultsimilarityinfo">90.32%</div>
          <div class="resulttitle"><strong>Sousou no Frieren - 1</strong> Frieren: Beyond Journey\`s End TV Series (2023-2024)</div>
          <div class="resultcontentcolumn">
            <span class="subtext"><strong>Est Time: </strong>00:07:23 / 00:26:00</span><br/>
          </div>
          <div class="resultmiscinfo">
            <a href="https://anidb.net/anime/17617"><img/></a>
          </div>
        </td>
      </tr>
    </table>
  </div>
</div>
`

describe('parseSauceNaoHtml', () => {
  test('parses live SauceNAO anime matches with AniDB id, episode number, and timestamp', () => {
    expect(parseSauceNaoHtml(FRIEREN_HTML)).toEqual({
      matches: [{
        uri: 'anidb:17617',
        moments: [{ episode: 1, from: 443 }],
      }],
    })
  })

  test('prefers anilist over mal over anidb over imdb/omdb, and parses SxxExx TV episodes', () => {
    const html = `
      <table class="resulttable">
        <tr><td class="resulttablecontent">
          <div class="resultsimilarityinfo">88.50%</div>
          <div class="resulttitle"><strong>Show Title - 3</strong></div>
          <div class="resultcontentcolumn"><span class="subtext"><strong>Est Time: </strong>00:12:00 / 00:24:00</span></div>
          <div class="resultmiscinfo">
            <a href="https://anidb.net/anime/999">AniDB</a>
            <a href="https://myanimelist.net/anime/52991">MAL</a>
            <a href="https://anilist.co/anime/154587">AniList</a>
          </div>
        </td></tr>
      </table>
      <table class="resulttable">
        <tr><td class="resulttablecontent">
          <div class="resultsimilarityinfo">82.10%</div>
          <div class="resulttitle"><strong>Sherlock - S01E02</strong> TV Show (2010-)</div>
          <div class="resultcontentcolumn"><span class="subtext"><strong>Est Time: </strong>01:05:10 / 01:28:00</span></div>
          <div class="resultmiscinfo">
            <a href="https://www.imdb.com/title/tt1475582/">IMDb</a>
          </div>
        </td></tr>
      </table>
      <table class="resulttable">
        <tr><td class="resulttablecontent">
          <div class="resultsimilarityinfo">75.00%</div>
          <div class="resulttitle"><strong>Inception (2010)</strong> Movie</div>
          <div class="resultcontentcolumn"></div>
          <div class="resultmiscinfo">
            <a href="https://www.imdb.com/title/tt1375666/">IMDb</a>
          </div>
        </td></tr>
      </table>
      <table class="resulttable">
        <tr><td class="resulttablecontent">
          <div class="resultsimilarityinfo">45.00%</div>
          <div class="resulttitle"><strong>Low Confidence - 1</strong></div>
          <div class="resultmiscinfo"><a href="https://anilist.co/anime/1">AniList</a></div>
        </td></tr>
      </table>
    `
    expect(parseSauceNaoHtml(html)).toEqual({
      matches: [
        { uri: 'anilist:154587', anilist: 154587, moments: [{ episode: 3, from: 720 }] },
        { uri: 'omdb:tt1475582', moments: [{ season: 1, episode: 2, from: 3910 }] },
        { uri: 'omdb:tt1375666', moments: [] },
      ],
    })
  })

  test('merges duplicate rows for the same URI using the earliest timestamp', () => {
    const html = `
      <table class="resulttable"><tr><td>
        <div class="resultsimilarityinfo">92.0%</div>
        <div class="resulttitle">Example - 4</div>
        <div class="resultcontentcolumn"><span class="subtext"><strong>Est Time: </strong>00:05:00 / 00:24:00</span></div>
        <a href="https://anilist.co/anime/42">AniList</a>
      </td></tr></table>
      <table class="resulttable"><tr><td>
        <div class="resultsimilarityinfo">89.0%</div>
        <div class="resulttitle">Example - 4</div>
        <div class="resultcontentcolumn"><span class="subtext"><strong>Est Time: </strong>00:04:12 / 00:24:00</span></div>
        <a href="https://anilist.co/anime/42">AniList</a>
      </td></tr></table>
    `
    expect(parseSauceNaoHtml(html)).toEqual({
      matches: [{ uri: 'anilist:42', anilist: 42, moments: [{ episode: 4, from: 252 }] }],
    })
  })

  test('reports limit, busy, Cloudflare challenge, and failed responses cleanly', () => {
    expect(parseSauceNaoHtml('Your Daily Search Limit Exceeded (100)')).toEqual({ error: 'limit' })
    expect(parseSauceNaoHtml('Search Rate Too High! Your IP has exceeded the 30 second search limit.')).toEqual({ error: 'busy' })
    expect(parseSauceNaoHtml('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>')).toEqual({ error: 'busy' })
    expect(parseSauceNaoHtml('Error: Problem with remote file or invalid image')).toEqual({ error: 'failed' })
    expect(parseSauceNaoHtml('<html><body>No matches found</body></html>')).toEqual({ matches: [] })
  })

  test('parses resulttable matches whose titles contain rate-limit phrases and does not read a 4-digit release year as an episode number', () => {
    const html = `
      <table class="resulttable"><tr><td class="resulttablecontent">
        <div class="resultsimilarityinfo">89.5%</div>
        <div class="resulttitle"><strong>Slow Down - 2019</strong></div>
        <div class="resultcontentcolumn"><span class="subtext"><strong>Est Time: </strong>00:02:00 / 00:24:00</span></div>
        <div class="resultmiscinfo"><a href="https://anilist.co/anime/9988">AniList</a></div>
      </td></tr></table>
    `
    expect(parseSauceNaoHtml(html)).toEqual({
      matches: [{
        uri: 'anilist:9988',
        anilist: 9988,
        moments: [{ episode: null, from: 120 }],
      }],
    })
  })
})
