import type { ComponentChildren, RefObject } from 'preact'
import type { WindowSignIn } from '../../sources/login-window'
import type { TrackerSite } from '../../tracking/site-sessions'
import type { SiteState, SiteStatus, StatusSite } from '../../tracking/site-status'
import type { FknBackend } from '../../utils/fkn-backend'

import { useEffect, useRef, useState } from 'preact/hooks'

import { ConfirmAction } from './confirm'

export type { TrackerSite }

/**
 * What the Accounts section reaches, handed in so the section renders and acts the same over fakes.
 * `backend` is undefined until it is known whether the extension runs here, and no site offers an
 * action until then: what a sign out does depends on it.
 */
export type AccountsProps = {
  backend: FknBackend | undefined
  crunchyroll: {
    /** Opens the sign-in window, so it is called first thing in the click. */
    signIn: () => Promise<WindowSignIn>
    /** Removes Crunchyroll's cookies from FKN's jar. Cloud only. */
    signOut: () => Promise<void>
  }
  sites: {
    isConnected: (site: TrackerSite) => boolean
    watch: (site: TrackerSite, listener: () => void) => () => void
    /** Opens the sign-in window, so it is called first thing in the click. */
    signIn: (site: TrackerSite) => Promise<WindowSignIn>
    signOut: (site: TrackerSite, backend: FknBackend) => Promise<void>
  }
  /** Whether the viewer was signed in to each site when stub last learned it. */
  status: {
    read: (site: StatusSite) => SiteStatus | undefined
    watch: (site: StatusSite, listener: () => void) => () => void
    /** Asks the site again when what stub remembers of it is stale, and remembers the answer. Never rejects. */
    refresh: (site: StatusSite, backend: FknBackend) => void
  }
}

type Note = { text: string, error?: boolean }

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

const signInNote = (name: string, outcome: WindowSignIn): Note => {
  switch (outcome) {
    case 'authed': return { text: `Signed in to ${name}.` }
    case 'closed': return { text: 'The sign-in window closed.' }
    case 'blocked': return { text: 'The browser blocked the sign-in window. Allow pop-ups for this page and try again.', error: true }
    case 'unsupported': return { text: `Connected to ${name}.` }
  }
}

const STATE_LABEL: Record<SiteState, string> = { 'signed-in': 'Signed in', 'signed-out': 'Signed out' }

/** The site's remembered state, read again whenever stub records a new one. */
const useSiteStatus = (status: AccountsProps['status'], site: StatusSite) => {
  const [, setRevision] = useState(0)
  useEffect(() => status.watch(site, () => setRevision(revision => revision + 1)), [status, site])
  return status.read(site)
}

/** Asks the site again when the section opens and each time the page comes back into view, while `enabled`. */
const useRefresh = (status: AccountsProps['status'], site: StatusSite, backend: FknBackend | undefined, enabled: boolean) => {
  useEffect(() => {
    if (!backend || !enabled) return
    const refresh = () => { if (document.visibilityState !== 'hidden') status.refresh(site, backend) }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [status, site, backend, enabled])
}

const Row = ({ id, title, state, on, heading, children }: { id: string, title: string, state?: string, on?: boolean, heading?: RefObject<HTMLHeadingElement>, children: ComponentChildren }) => (
  <div className="row account" data-account={id}>
    <div className="head">
      <h3 ref={heading} tabIndex={-1}>{title}</h3>
      {state ? <span className={`state${on ? ' on' : ''}`}>{state}</span> : undefined}
    </div>
    {children}
  </div>
)

// always mounted, empty until there is a note: a status region inserted with its text is not announced by every screen reader
const NoteLine = ({ note }: { note: Note | undefined }) =>
  <p className={`note${note?.error ? ' error' : ''}`} role="status">{note?.text}</p>

/** Keeps a note from landing on a row that is gone. */
const useMounted = () => {
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  return mounted
}

const CrunchyrollRow = ({ backend, crunchyroll, status }: Pick<AccountsProps, 'backend' | 'crunchyroll' | 'status'>) => {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>()
  const mounted = useMounted()
  const heading = useRef<HTMLHeadingElement>(null)
  const remembered = useSiteStatus(status, 'crunchyroll')
  // only a site stub has learned of before: on the cloud the check asks FKN for a permission
  useRefresh(status, 'crunchyroll', backend, remembered !== undefined)

  const signIn = () => {
    const signingIn = crunchyroll.signIn()
    setBusy(true)
    setNote(undefined)
    signingIn
      .then(outcome => { if (mounted.current) setNote(signInNote('Crunchyroll', outcome)) })
      .catch(error => { if (mounted.current) setNote({ text: messageOf(error), error: true }) })
      .finally(() => { if (mounted.current) setBusy(false) })
  }

  const signOut = () => crunchyroll.signOut().then(
    () => { if (mounted.current) setNote({ text: 'Signed out.' }) },
    error => { if (mounted.current) setNote({ text: `Could not sign out of Crunchyroll: ${messageOf(error)}. Try again.`, error: true }) },
  )

  return (
    <Row
      id="crunchyroll"
      title="Crunchyroll"
      state={remembered && STATE_LABEL[remembered.state]}
      on={remembered?.state === 'signed-in'}
      heading={heading}
    >
      {backend === 'cloud'
        ? (
          // both until stub has learned which one the session is in
          <div className="actions">
            {remembered?.state === 'signed-in'
              ? undefined
              : <button type="button" disabled={busy} onClick={signIn}>{busy ? 'Signing in...' : 'Sign in'}</button>}
            {remembered?.state === 'signed-out'
              ? undefined
              : (
                <ConfirmAction
                  label="Sign out"
                  name="Sign out of Crunchyroll"
                  home={heading}
                  confirmLabel="Yes, sign out"
                  busyLabel="Signing out..."
                  question="Sign out of Crunchyroll in every fkn.app app?"
                  onConfirm={signOut}
                />
              )}
          </div>
        )
        : backend === 'extension'
          ? (
            <div className="actions">
              <a className="link" href="https://www.crunchyroll.com" target="_blank" rel="noreferrer">Open crunchyroll.com</a>
            </div>
          )
          : <p>Loading...</p>}
      <NoteLine note={note}/>
    </Row>
  )
}

const TRACKER_SITES: { site: TrackerSite, name: string }[] = [
  { site: 'anilist', name: 'AniList' },
  { site: 'mal', name: 'MyAnimeList' },
]

const TrackerRow = ({ site, name, backend, sites, status }: { site: TrackerSite, name: string } & Pick<AccountsProps, 'backend' | 'sites' | 'status'>) => {
  const [connected, setConnected] = useState(() => sites.isConnected(site))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>()
  const mounted = useMounted()
  const heading = useRef<HTMLHeadingElement>(null)
  const remembered = useSiteStatus(status, site)

  useEffect(() => {
    setConnected(sites.isConnected(site))
    return sites.watch(site, () => { if (mounted.current) setConnected(sites.isConnected(site)) })
  }, [sites, site])

  // checking is what attaches the site's session frame, so only a site connected here is asked
  useRefresh(status, site, backend, connected)

  const settle = () => {
    if (mounted.current) setConnected(sites.isConnected(site))
  }

  const signIn = () => {
    const signingIn = sites.signIn(site)
    setBusy(true)
    setNote(undefined)
    signingIn
      .then(outcome => { if (mounted.current) setNote(signInNote(name, outcome)) })
      .catch(error => { if (mounted.current) setNote({ text: messageOf(error), error: true }) })
      .finally(() => {
        if (mounted.current) setBusy(false)
        settle()
      })
  }

  const signOut = (current: FknBackend) => sites.signOut(site, current).then(
    () => {
      if (mounted.current) setNote({ text: current === 'cloud' ? 'Signed out.' : 'Disconnected.' })
      settle()
    },
    error => {
      if (mounted.current) setNote({ text: `Could not finish signing out of ${name}: ${messageOf(error)}. Sign in and out again to retry.`, error: true })
      settle()
    },
  )

  return (
    <Row
      id={site}
      title={name}
      state={!connected ? 'Not connected' : remembered && STATE_LABEL[remembered.state]}
      on={connected && remembered?.state !== 'signed-out'}
      heading={heading}
    >
      {backend
        ? (
          <div className="actions">
            {connected
              ? (
                <ConfirmAction
                  label={backend === 'cloud' ? 'Sign out' : 'Disconnect'}
                  name={backend === 'cloud' ? `Sign out of ${name}` : `Disconnect ${name}`}
                  home={heading}
                  confirmLabel={backend === 'cloud' ? 'Yes, sign out' : 'Yes, disconnect'}
                  busyLabel={backend === 'cloud' ? 'Signing out...' : 'Disconnecting...'}
                  question={backend === 'cloud' ? `Sign out of ${name} in every fkn.app app?` : `Disconnect ${name} on this device?`}
                  onConfirm={() => signOut(backend)}
                />
              )
              : <button type="button" disabled={busy} onClick={signIn}>{busy ? 'Signing in...' : backend === 'cloud' ? 'Sign in' : 'Connect'}</button>}
          </div>
        )
        : undefined}
      <NoteLine note={note}/>
    </Row>
  )
}

const NetflixRow = ({ backend }: Pick<AccountsProps, 'backend'>) => (
  <Row id="netflix" title="Netflix">
    {backend === 'extension'
      ? <div className="actions"><a className="link" href="https://www.netflix.com" target="_blank" rel="noreferrer">Open netflix.com</a></div>
      : <p>Needs the FKN browser extension.</p>}
  </Row>
)

/** Every sign-in stub uses, and the way out of it where there is one. */
export const AccountsSection = ({ backend, crunchyroll, sites, status }: AccountsProps) => (
  <div className="rows">
    <CrunchyrollRow backend={backend} crunchyroll={crunchyroll} status={status}/>
    {TRACKER_SITES.map(entry => <TrackerRow key={entry.site} {...entry} backend={backend} sites={sites} status={status}/>)}
    <NetflixRow backend={backend}/>
  </div>
)
