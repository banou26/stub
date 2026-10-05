import type { ComponentChildren } from 'preact'
import type { FknBackend } from '../../utils/fkn-backend'

import { css } from '@emotion/react'
import { useCallback, useEffect, useState } from 'preact/hooks'

import { detectBackend } from '../../utils/fkn-backend'
import { useAccount } from '../../utils/use-account'
import { cancelReset } from '../scroll-reset'
import { AccountsSection } from './accounts'
import { clearers } from './clearers'
import { DataSection } from './data'
import { SETTINGS_SECTIONS, sectionFromHash, type SettingsSectionId } from './sections'
import { SourcesSection } from './sources'
import { browserStores } from './stored-data'
import { sectionStyle } from './style'
import { crunchyroll, sites } from './wiring'

const style = css`
  display: grid;
  grid-template-columns: 17rem minmax(0, 1fr);
  column-gap: 4rem;
  max-width: 108rem;
  margin: 0 auto;
  padding: calc(var(--stub-header-height) + 3rem) 3rem 6rem;
  color: rgba(255, 255, 255, 0.8);

  & > h1 {
    grid-column: 1 / -1;
    font-size: 3rem;
    font-weight: 700;
    color: #fff;
    margin-bottom: 2.4rem;
  }

  .index {
    position: sticky;
    top: calc(var(--stub-header-height) + 2rem);
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .index a {
    padding: 0.8rem 1.2rem;
    border-radius: 0.6rem;
    font-size: 1.5rem;
    color: rgba(255, 255, 255, 0.6);
    transition: background 0.15s, color 0.15s;
  }

  .index a:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
  .index a[aria-current='true'] { background: rgba(255, 255, 255, 0.1); color: #fff; }

  .sections { min-width: 0; }

  @media (max-width: 768px) {
    grid-template-columns: minmax(0, 1fr);
    padding: calc(var(--stub-header-height) + 2rem) 1.6rem 4rem;

    & > h1 { margin-bottom: 1.4rem; }

    .index {
      position: static;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.8rem;
      margin-bottom: 2.4rem;
    }

    .index a {
      padding: 0.6rem 1.4rem;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 2rem;
      font-size: 1.4rem;
    }
  }
`

const Section = ({ id, children }: { id: SettingsSectionId, children: ComponentChildren }) => (
  <section id={id} css={sectionStyle} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>{SETTINGS_SECTIONS.find(section => section.id === id)!.title}</h2>
    {children}
  </section>
)

const Settings = () => {
  const account = useAccount()
  const [backend, setBackend] = useState<FknBackend>()
  const [current, setCurrent] = useState(() => sectionFromHash(location.hash))
  const [keysCleared, setKeysCleared] = useState(0)
  // anything a section changed can change what the Data section lists, which it reads on render
  const [, setRevision] = useState(0)
  const changed = useCallback(() => setRevision(revision => revision + 1), [])

  useEffect(() => {
    let cancelled = false
    void detectBackend().then(detected => { if (!cancelled) setBackend(detected) })
    return () => { cancelled = true }
  }, [])

  // A link from elsewhere in the app arrives by pushState, which neither scrolls to a fragment nor stops
  // the navigation's own reset to the top (router/scroll-reset.ts), so the section is placed here.
  useEffect(() => {
    const id = sectionFromHash(location.hash)
    if (!id) return
    cancelReset()
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const follow = () => setCurrent(sectionFromHash(location.hash))
    addEventListener('hashchange', follow)
    addEventListener('storage', changed)
    return () => {
      removeEventListener('hashchange', follow)
      removeEventListener('storage', changed)
    }
  }, [])

  return (
    <div css={style}>
      <h1>Settings</h1>
      <nav className="index" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map(section => (
          <a key={section.id} href={`#${section.id}`} aria-current={current === section.id ? 'true' : undefined}>{section.title}</a>
        ))}
      </nav>
      <div className="sections">
        <Section id="accounts">
          <p className="intro">Every account and sign-in stub uses, what it is for, and how to end it.</p>
          <AccountsSection account={account} backend={backend} crunchyroll={crunchyroll} sites={sites} onChange={changed}/>
        </Section>
        <Section id="sources">
          <SourcesSection keysCleared={keysCleared} onChange={changed}/>
        </Section>
        <Section id="tracking">
          <p className="intro">
            Nothing to set here yet. You track a title from its own tracking panel. The AniList and
            MyAnimeList sign-ins are under <a className="link" href="#accounts">Accounts</a>, and what
            stub's list keeps is under <a className="link" href="#data">Data</a>.
          </p>
        </Section>
        <Section id="playback">
          <p className="intro">
            stub does not remember the player's volume, speed or captions: every episode starts with the
            player's own defaults.
          </p>
        </Section>
        <Section id="data">
          <p className="intro">
            What stub keeps about you, where and for how long. stub has no server of its own: everything
            here is in your browser, with FKN, or with the site it belongs to.
          </p>
          <DataSection stores={browserStores} clearers={clearers} onCleared={id => { if (id === 'api-keys') setKeysCleared(count => count + 1); changed() }}/>
        </Section>
      </div>
    </div>
  )
}

export default Settings
