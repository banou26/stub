import { css } from '@emotion/react'
import { Link } from 'wouter'

import LegalDoc from '../../components/legal-doc'
import { STORED } from '../settings/stored-data'

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

const sentence = (text: string) => text.endsWith('.') ? text : `${text}.`

const Privacy = () => (
  <LegalDoc>
    <h1>Privacy</h1>
    <div className="updated">Last updated 6 October 2026</div>

    <p>
      stub is an independent, non-commercial personal project. In short: it has no accounts and no server
      of its own, runs no analytics, and keeps your settings and your watch list in your browser, or in
      your own FKN account when you choose to.
    </p>

    <h2>What stub keeps</h2>
    <p>
      stub sets no advertising or tracking cookies and runs no analytics or telemetry. This is everything
      it keeps, where, and for how long. Each item is listed again, with a way to clear it, in{' '}
      <Link to="/settings#data">Settings, under Data</Link>.
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
      device.
    </p>

    <h2>Sign-ins to other sites</h2>
    <p>
      stub plays Crunchyroll and tracks your AniList and MyAnimeList lists with your own accounts on those
      sites, and you sign in on each site's own page, in an FKN window. Without the FKN browser extension,
      the cookies that sign-in sets are kept by FKN, in a cookie jar every fkn.app app shares, and not by
      stub. Signing out in <Link to="/settings#accounts">Settings, under Accounts</Link> removes them from
      FKN. The site itself is not told, so its session stays valid there until it expires, held by nobody.
    </p>
    <p>
      With the extension, stub uses your browser's own sessions for these sites and for Netflix. Those stay
      in your browser, and you sign in and out of them on the sites themselves.
    </p>

    <h2>Network requests &amp; third parties</h2>
    <p>
      To fetch titles, artwork, and streams, stub sends requests through the FKN platform
      proxy, which then reaches third-party services such as AniList, MyAnimeList,
      Crunchyroll, JustWatch, and Netflix. The proxy processes only the connection metadata
      needed to route and rate-limit a request (for example your IP address) and requires
      no account; how the FKN platform handles that data is described in the{' '}
      <a href="https://fkn.app/privacy" target="_blank" rel="noreferrer noopener">
        FKN platform privacy policy
      </a>
      . Each third-party service receives the requests made to it and applies its own
      privacy policy, especially when you sign in to one (for example Crunchyroll) to watch.
      An API key you add is sent only with the requests to its own source.
    </p>

    <h2>The optional browser extension</h2>
    <p>
      If you install the FKN browser extension, it works with your own already-logged-in
      sessions locally on your device so you can play content you have access to. Those
      credentials stay in your browser; stub never receives them.
    </p>

    <h2>Your control</h2>
    <p>
      Everything above can be seen and cleared in Settings. Your watch list stays until you remove its
      entries, and signing out of FKN takes your account's list off the device. Your party name and the
      party you are in go when you close the tab. If you use the browser extension, you can review and
      revoke its access at any time from the extension itself.
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
