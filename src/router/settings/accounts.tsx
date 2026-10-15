import type { ComponentChildren, RefObject } from 'preact'
import type { WindowSignIn } from '../../sources/login-window'
import type { TrackerSite } from '../../tracking/site-sessions'
import type { SiteState, SiteStatus, StatusSite } from '../../tracking/site-status'
import type { FknBackend } from '../../utils/fkn-backend'

import { useEffect, useRef, useState } from 'preact/hooks'

import { siteAsks } from '../../site'
import { ConfirmAction } from './confirm'
import { primePlaysOnCloud, primeSiteFor } from '../../sources/amazon/session'
import { CountryRow, useViewerCountry } from './country'

export type { TrackerSite }

/** A streaming site stub plays: its sign-in window, and its cookies in FKN's jar. */
export type StreamingAccount = {
  /** Opens the sign-in window, so it is called first thing in the click. */
  signIn: () => Promise<WindowSignIn>
  /** Removes the site's cookies from FKN's jar. Cloud only. */
  signOut: () => Promise<void>
}

/**
 * What the Accounts section reaches, handed in so the section renders and acts the same over fakes.
 * `backend` is undefined until it is known whether the extension runs here, and no site offers an
 * action until then: what a sign out does depends on it.
 */
export type AccountsProps = {
  backend: FknBackend | undefined
  crunchyroll: StreamingAccount
  prime: StreamingAccount
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
    /**
     * Asks Crunchyroll again when what stub remembers of it is stale, and remembers the answer. Never
     * rejects. The trackers' sites are not asked here: their own paced reads keep what stub remembers.
     */
    refresh: (site: 'crunchyroll', backend: FknBackend) => void
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

/** Asks Crunchyroll again when the section opens and each time the page comes back into view, while `enabled`. */
const useRefresh = (status: AccountsProps['status'], backend: FknBackend | undefined, enabled: boolean) => {
  useEffect(() => {
    if (!backend || !enabled) return
    const refresh = () => { if (document.visibilityState !== 'hidden') status.refresh('crunchyroll', backend) }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [status, backend, enabled])
}

const Row = ({ id, title, state, on, heading, children }: { id: string, title: string, state?: string, on?: boolean, heading?: RefObject<HTMLHeadingElement | null>, children: ComponentChildren }) => (
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

const STREAMING_SITES = ([
  { site: 'crunchyroll', origin: 'cr', name: 'Crunchyroll', hostFor: () => 'crunchyroll.com', signsInOnCloud: () => true, checked: true },
  { site: 'prime', origin: 'amazon', name: 'Prime Video', hostFor: primeSiteFor, signsInOnCloud: primePlaysOnCloud, checked: false },
] satisfies {
  site: 'crunchyroll' | 'prime', origin: string, name: string, hostFor: (country: string) => string, signsInOnCloud: (host: string) => boolean, checked: boolean,
}[]).filter(entry => siteAsks(entry.origin))

type StreamingRowProps = (typeof STREAMING_SITES)[number] & { account: StreamingAccount } & Pick<AccountsProps, 'backend' | 'status'>

const StreamingRow = ({ site, name, hostFor, signsInOnCloud, checked, account, backend, status }: StreamingRowProps) => {
  const host = hostFor(useViewerCountry())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>()
  const mounted = useMounted()
  const heading = useRef<HTMLHeadingElement>(null)
  const remembered = useSiteStatus(status, site)
  // the cloud only, where the check reuses the site's device id (with the extension each check is a new
  // device), and only once stub knows of the site, since the check asks FKN for a permission
  useRefresh(status, backend, checked && backend === 'cloud' && remembered !== undefined)

  const signIn = () => {
    const signingIn = account.signIn()
    setBusy(true)
    setNote(undefined)
    signingIn
      .then(outcome => { if (mounted.current) setNote(signInNote(name, outcome)) })
      .catch(error => { if (mounted.current) setNote({ text: messageOf(error), error: true }) })
      .finally(() => { if (mounted.current) setBusy(false) })
  }

  const signOut = () => account.signOut().then(
    () => { if (mounted.current) setNote({ text: 'Signed out.' }) },
    error => { if (mounted.current) setNote({ text: `Could not sign out of ${name}: ${messageOf(error)}. Try again.`, error: true }) },
  )

  return (
    <Row
      id={site}
      title={name}
      state={remembered && STATE_LABEL[remembered.state]}
      on={remembered?.state === 'signed-in'}
      heading={heading}
    >
      {backend === 'cloud' && signsInOnCloud(host)
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
                  name={`Sign out of ${name}`}
                  home={heading}
                  confirmLabel="Yes, sign out"
                  busyLabel="Signing out..."
                  question={`Sign out of ${name} in every fkn.app app?`}
                  onConfirm={signOut}
                />
              )}
          </div>
        )
        : backend
          ? (
            <div className="actions">
              <a className="link" href={`https://www.${host}`} target="_blank" rel="noreferrer">Open {host}</a>
            </div>
          )
          : <p>Loading...</p>}
      <NoteLine note={note}/>
    </Row>
  )
}

const TRACKER_SITES = ([
  { site: 'anilist', name: 'AniList' },
  { site: 'mal', name: 'MyAnimeList' },
] satisfies { site: TrackerSite, name: string }[]).filter(entry => siteAsks(entry.site))

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

/** The viewer's country, then every sign-in stub uses and the way out of it where there is one. */
export const AccountsSection = ({ backend, sites, status, ...streaming }: AccountsProps) => (
  <div className="rows">
    <CountryRow/>
    {STREAMING_SITES.map(entry => <StreamingRow key={entry.site} {...entry} account={streaming[entry.site]} backend={backend} status={status}/>)}
    {TRACKER_SITES.map(entry => <TrackerRow key={entry.site} {...entry} backend={backend} sites={sites} status={status}/>)}
    <NetflixRow backend={backend}/>
  </div>
)
