import type { FknBackend } from '../../utils/fkn-backend'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'
import { useLocationProperty } from 'wouter/use-browser-location'

import { detectBackend } from '../../utils/fkn-backend'
import { scrollToTop } from '../scroll-reset'
import { AccountsSection } from './accounts'
import { SETTINGS_SECTIONS, sectionFromHash } from './sections'
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
  .index a:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.8); outline-offset: 2px; }

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

    .index a[aria-current='true'] { border-color: rgba(255, 255, 255, 0.6); }
  }
`

const currentHash = () => location.hash

// The panel carries no id a category's fragment names, so following a category link never scrolls the
// page to it: the link scrolls to the top itself, and only the panel changes. The fragment is read through
// wouter's location subscription because a <Link to="/settings"> drops it with a pushState, which
// sends no hashchange.
const Settings = () => {
  const [backend, setBackend] = useState<FknBackend>()
  const current = sectionFromHash(useLocationProperty(currentHash))

  useEffect(() => {
    let cancelled = false
    void detectBackend().then(detected => { if (!cancelled) setBackend(detected) })
    return () => { cancelled = true }
  }, [])

  return (
    <div css={style}>
      <h1>Settings</h1>
      <nav className="index" aria-label="Settings categories">
        {SETTINGS_SECTIONS.map(section => (
          <a key={section.id} href={`#${section.id}`} aria-current={current === section.id ? 'true' : undefined} onClick={scrollToTop}>{section.title}</a>
        ))}
      </nav>
      <section css={sectionStyle} data-section={current} aria-labelledby="settings-section-title">
        <h2 id="settings-section-title">{SETTINGS_SECTIONS.find(section => section.id === current)!.title}</h2>
        {current === 'accounts'
          ? (
            <>
              <p className="intro">The sites stub signs in to for you, what each one is for, and how to sign out.</p>
              <AccountsSection backend={backend} crunchyroll={crunchyroll} sites={sites} status={status}/>
            </>
          )
          : <SourcesSection/>}
      </section>
    </div>
  )
}

export default Settings
