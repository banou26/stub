import type { ComponentChildren } from 'preact'
import type { FknBackend } from '../../utils/fkn-backend'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'

import { detectBackend } from '../../utils/fkn-backend'
import { AccountsSection } from './accounts'
import { SETTINGS_SECTIONS, sectionFromHash, type SettingsSectionId } from './sections'
import { SourcesSection } from './sources'
import { sectionStyle } from './style'
import { crunchyroll, sites, status } from './wiring'

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
  const [backend, setBackend] = useState<FknBackend>()
  const [current, setCurrent] = useState(() => sectionFromHash(location.hash))

  useEffect(() => {
    let cancelled = false
    void detectBackend().then(detected => { if (!cancelled) setBackend(detected) })
    return () => { cancelled = true }
  }, [])

  // A link from elsewhere in the app arrives by pushState, which does not scroll to a fragment, so the
  // section is placed here. The navigation's own reset to the top (router/scroll-reset.ts) asked for its
  // frame during the pushState, before this effect ran, so it has already run when this frame does.
  useEffect(() => {
    const id = sectionFromHash(location.hash)
    if (!id) return
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const follow = () => setCurrent(sectionFromHash(location.hash))
    addEventListener('hashchange', follow)
    return () => removeEventListener('hashchange', follow)
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
          <AccountsSection backend={backend} crunchyroll={crunchyroll} sites={sites} status={status}/>
        </Section>
        <Section id="sources">
          <SourcesSection/>
        </Section>
        <Section id="tracking">
          <p className="intro">
            Nothing to set here yet. You track a title from the tracking row on its page. The AniList and
            MyAnimeList sign-ins are under <a className="link" href="#accounts">Accounts</a>.
          </p>
        </Section>
        <Section id="playback">
          <p className="intro">
            stub does not remember the player's volume, speed or captions: every episode starts with the
            player's own defaults.
          </p>
        </Section>
      </div>
    </div>
  )
}

export default Settings
