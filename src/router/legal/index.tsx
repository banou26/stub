import { Link } from 'wouter'

import { getRoutePath, Route } from '../path'
import LegalDoc from '../../components/legal-doc'

const Legal = () => (
  <LegalDoc>
    <h1>Legal &amp; Terms</h1>
    <div className="updated">Last updated 24 October 2026</div>

    <p>
      stub is an independent, non-commercial personal project, provided “as is” without
      warranties of any kind.
    </p>

    <h2>No hosted content</h2>
    <p>
      stub hosts, stores, and distributes no media of its own. Titles, descriptions,
      artwork, ratings, and playback streams are retrieved on demand from third-party
      services (including AniList, MyAnimeList, Crunchyroll, JustWatch, and Netflix). So that
      titles still show when those services are unreachable, stub’s files also carry titles,
      artwork addresses, and descriptions compiled from the anime-offline-database, AniDB,
      Kitsu, and those services. All of it remains the property of its respective owners. You
      access those services with your own accounts and are responsible for complying with their
      terms.
    </p>
    <p>
      Contains information from{' '}
      <a href="https://github.com/cedya77/anime-offline-database" target="_blank" rel="noreferrer noopener">
        cedya77/anime-offline-database
      </a>
      , continuing{' '}
      <a href="https://github.com/manami-project/anime-offline-database" target="_blank" rel="noreferrer noopener">
        manami-project/anime-offline-database
      </a>
      , made available under the{' '}
      <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer noopener">
        ODbL
      </a>
      .
    </p>
    <p>
      Contains information from{' '}
      <a href="https://www.tvmaze.com/" target="_blank" rel="noreferrer noopener">TVmaze</a>
      , made available under{' '}
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer noopener">
        CC BY-SA
      </a>
      .
    </p>

    <h2>Personal use</h2>
    <p>
      stub is a technical showcase of in-browser media aggregation, intended for personal,
      non-commercial use. It is not a content provider.
    </p>

    <h2>Privacy</h2>
    <p>
      stub keeps no accounts and stores no personal data. See the{' '}
      <Link href={getRoutePath(Route.PRIVACY)}>Privacy page</Link> for what is and isn’t
      handled when you use it.
    </p>

    <h2>Rights holders</h2>
    <p>
      Apart from the compiled titles, artwork addresses, and descriptions above, stub stores
      no content itself; anything you see lives on the third-party service it came from. If
      you are a rights holder with a concern, you can reach the maintainer through the
      project repository at{' '}
      <a href="https://github.com/banou26/stub" target="_blank" rel="noreferrer noopener">
        github.com/banou26/stub
      </a>
      .
    </p>

    <h2>Liability</h2>
    <p>
      stub is provided without warranty of any kind. The maintainer is not liable for any
      damages arising from its use, or for the availability, accuracy, or legality of any
      third-party service it connects to.
    </p>
  </LegalDoc>
)

export default Legal
