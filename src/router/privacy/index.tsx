import { css } from '@emotion/react'
import { Link } from 'wouter'

import LegalDoc from '../../components/legal-doc'
import { STORED } from './stored-data'

const keptStyle = css`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0 0 1.6rem;

  li {
    font-size: 1.5rem;
    line-height: 1.7;
    padding-left: 1.4rem;
    border-left: 2px solid rgba(255, 255, 255, 0.12);
  }

  strong { color: #fff; }
  .facts { color: rgba(255, 255, 255, 0.55); }
`

const hostsStyle = css`
  margin: 0 0 1.6rem;
  padding-left: 2rem;

  li {
    font-size: 1.5rem;
    line-height: 1.7;
  }

  .host { color: rgba(255, 255, 255, 0.55); }
`

const sentence = (text: string) => text.endsWith('.') ? text : `${text}.`

const Privacy = () => (
  <LegalDoc>
    <h1>Privacy</h1>
    <div className="updated">Last updated 26 October 2026</div>

    <p>
      stub is an independent, non-commercial personal project. In short: it has no accounts and no server
      of its own, runs no analytics, and keeps your settings and your watch list in your browser, or in
      your own FKN account when you choose to.
    </p>

    <h2>What stub keeps</h2>
    <p>
      stub sets no advertising or tracking cookies and runs no analytics or telemetry. This is everything
      it keeps, where, and for how long. You sign out of a site and remove a source you added in{' '}
      <Link to="/settings#sources">Settings, under Sources</Link>. Clearing this site's data in your
      browser removes everything stub keeps in this browser.
    </p>
    <ul css={keptStyle}>
      {STORED.map(item => (
        <li key={item.id}>
          <strong>{item.title}.</strong> {item.what}{' '}
          <span className="facts">Where: {sentence(item.where)} How long: {sentence(item.lasts)}</span>
        </li>
      ))}
    </ul>
    <p>
      About stub's list: signed out, it is saved in your browser's storage for stub, on this device only.
      Signed in to an FKN account, stub uses that account's list instead: your changes are saved on the
      device and in the account's storage, encrypted in your browser before they leave the device, so
      every device signed in to the same account shows them. A list you kept before signing in is added
      to the account only if you choose to. When you sign out, the account's list is removed from the
      device. Removing an entry keeps a record that it was removed, with the entry's title and last
      values, so that every device using the list removes it too. There is no way to clear these records
      yet.
    </p>

    <h2>Sign-ins to other sites</h2>
    <p>
      stub plays Crunchyroll and Prime Video and tracks your AniList and MyAnimeList lists with your own
      accounts on those sites. Without the FKN browser extension, you sign in on each site's own page, in an
      FKN window, and the cookies that sign-in sets are kept by FKN, in a cookie jar every fkn.app app shares,
      and not by stub. Signing out in <Link to="/settings#sources">Settings, under Sources</Link>, removes
      that site's cookies from FKN. The site itself is not told, so its session stays valid there until it
      expires, held by nobody.
    </p>
    <p>
      With the extension, stub uses your browser's own sessions for these sites and for Netflix. Those stay
      in your browser, and you sign in and out of them on the sites themselves.
    </p>

    <h2>Network requests &amp; third parties</h2>
    <p>
      To fetch titles and streams, stub sends requests through the FKN platform
      proxy, which then reaches third-party services such as AniList (anilist.co), MyAnimeList,
      Crunchyroll, Prime Video and JustWatch. The proxy requires no account. It uses your IP
      address to rate-limit requests, and it keeps a copy of each answer for a while, under a
      key made from the whole request (its address, headers and body), so only an identical
      request is answered from that copy. How the FKN platform handles that data is described
      in the{' '}
      <a href="https://fkn.app/privacy" target="_blank" rel="noreferrer noopener">
        FKN platform privacy policy
      </a>
      . Each third-party service receives the requests made to it and applies its own
      privacy policy, especially when you sign in to one (for example Crunchyroll) to watch.
    </p>
    <p>
      The services that allow it are asked from your browser instead, not through the proxy, so each
      of them sees your IP address:
    </p>
    <ul css={hostsStyle}>
      <li>AniList <span className="host">graphql.anilist.co</span></li>
      <li>Anime News Network <span className="host">cdn.animenewsnetwork.com</span></li>
      <li>AnimeThemes <span className="host">graphql.animethemes.moe</span></li>
      <li>AniZip <span className="host">api.ani.zip</span></li>
      <li>Apple TV <span className="host">uts-api.itunes.apple.com</span></li>
      <li>Kitsu <span className="host">kitsu.io</span></li>
      <li>LiveChart <span className="host">www.livechart.me</span></li>
      <li>Netflix <span className="host">www.netflix.com</span>, whose catalogue depends on your country</li>
      <li>TheTVDB <span className="host">api4.thetvdb.com</span></li>
      <li>
        trace.moe <span className="host">api.trace.moe</span>, for a search by picture: it gets a short color code
        of the picture, never the picture itself, and FKN stores neither the code nor your IP address
      </li>
      <li>Trakt <span className="host">apiz.trakt.tv</span></li>
      <li>TVmaze <span className="host">api.tvmaze.com</span></li>
    </ul>
    <p>
      Artwork loads from each service's own image servers, theme videos from AnimeThemes (v.animethemes.moe),
      trailers from YouTube (www.youtube.com) and fonts from Google Fonts (fonts.googleapis.com and
      fonts.gstatic.com), and each of these sees your IP address too.
    </p>
    <p>
      JustWatch is asked for the streaming links of your country: the one you picked in{' '}
      <Link to="/settings#sources">Settings</Link>, or else the one your device's time zone is in.
      Only the country is sent, never the time zone.
    </p>

    <h2>The optional browser extension</h2>
    <p>
      If you install the FKN browser extension, it works with your own already-logged-in
      sessions locally on your device so you can play content you have access to. Those
      credentials stay in your browser; stub never receives them.
    </p>

    <h2>Your control</h2>
    <p>
      Disconnecting from FKN, in the account menu at the top right, takes your account's list off the
      device. Your party name and the party you are in go when you close the tab. If you use the browser extension, you can review and revoke its
      access at any time from the extension itself.
    </p>

    <h2>Contact</h2>
    <p>
      Questions about privacy can be raised through the project repository at{' '}
      <a href="https://github.com/banou26/stub" target="_blank" rel="noreferrer noopener">
        github.com/banou26/stub
      </a>
      .
    </p>
  </LegalDoc>
)

export default Privacy
