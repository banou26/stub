import type { ComponentChildren, RefObject } from 'preact'
import type { WindowSignIn } from '../../sources/login-window'
import type { TrackerSite } from '../../tracking/site-sessions'
import type { SiteState, SiteStatus, StatusSite } from '../../tracking/site-status'
import type { FknBackend } from '../../utils/fkn-backend'

import { useEffect, useRef, useState } from 'preact/hooks'

import { siteAsks } from '../../site'
import { ConfirmAction } from './confirm'
import { primePlaysOnCloud, primeSiteFor } from '../../sources/amazon/session'
import { useViewerCountry } from './country'

export type { TrackerSite }

/** A streaming site stub plays: its sign-in window, and its cookies in FKN's jar. */
export type StreamingAccount = {
  /** Opens the sign-in window, so it is called first thing in the click. */
  signIn: () => Promise<WindowSignIn>
  /** Removes the site's cookies from FKN's jar. Cloud only. */
  signOut: () => Promise<void>
}

/**
 * What the sources' accounts reach, handed in so the cards render and act the same over fakes.
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

/** Asks Crunchyroll again when its card shows and each time the page comes back into view, while `enabled`. */
const useRefresh = (status: AccountsProps['status'], backend: FknBackend | undefined, enabled: boolean) => {
  useEffect(() => {
    if (!backend || !enabled) return
    const refresh = () => { if (document.visibilityState !== 'hidden') status.refresh('crunchyroll', backend) }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [status, backend, enabled])
}

/** The card's heading, which a confirmed sign out gives the focus to, since it can take its button away. */
type Heading = RefObject<HTMLHeadingElement | null>

const Account = ({ id, state, on, children }: { id: string, state?: string, on?: boolean, children: ComponentChildren }) => (
  <div className="account" data-account={id}>
    {state ? <span className={`state${on ? ' on' : ''}`}>{state}</span> : undefined}
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

type StreamingProps = (typeof STREAMING_SITES)[number] & { account: StreamingAccount, heading: Heading } & Pick<AccountsProps, 'backend' | 'status'>

const Streaming = ({ site, name, hostFor, signsInOnCloud, checked, account, heading, backend, status }: StreamingProps) => {
  const host = hostFor(useViewerCountry())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>()
  const mounted = useMounted()
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

  const cloud = backend === 'cloud' && signsInOnCloud(host)
  // with nothing remembered it reads signed out: checking needs a permission, which Sign in asks for as it signs in
  const state = remembered?.state ?? (cloud ? 'signed-out' : undefined)

  return (
    <Account
      id={site}
      state={state && STATE_LABEL[state]}
      on={state === 'signed-in'}
    >
      {cloud
        ? (
          <div className="actions">
            {state === 'signed-in'
              ? (
                <ConfirmAction
                  label="Sign out"
                  name={`Sign out of ${name}`}
                  home={heading}
                  confirmLabel="Yes, sign out"
                  busyLabel="Signing out..."
                  question={`Sign out of ${name} in every fkn.app app?`}
                  onConfirm={signOut}
                />
              )
              : <button type="button" disabled={busy} onClick={signIn}>{busy ? 'Signing in...' : 'Sign in'}</button>}
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
    </Account>
  )
}

const TRACKER_SITES = ([
  { site: 'anilist', name: 'AniList', host: 'anilist.co' },
  { site: 'mal', name: 'MyAnimeList', host: 'myanimelist.net' },
] satisfies { site: TrackerSite, name: string, host: string }[]).filter(entry => siteAsks(entry.site))

const Tracker = ({ site, name, host, heading, backend, sites, status }: (typeof TRACKER_SITES)[number] & { heading: Heading } & Pick<AccountsProps, 'backend' | 'sites' | 'status'>) => {
  const [connected, setConnected] = useState(() => sites.isConnected(site))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>()
  const mounted = useMounted()
  const remembered = useSiteStatus(status, site)
  const signedIn = connected && remembered?.state !== 'signed-out'

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
    <Account
      id={site}
      state={!connected ? 'Not connected' : remembered && STATE_LABEL[remembered.state]}
      on={signedIn}
    >
      {backend
        ? (
          <div className="actions">
            {signedIn
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
              : backend === 'extension' && connected
                // Connect again would do nothing: the extension opens no sign-in window, the viewer signs in on the site
                ? <a className="link" href={`https://${host}`} target="_blank" rel="noreferrer">Open {host}</a>
                : <button type="button" disabled={busy} onClick={signIn}>{busy ? 'Signing in...' : backend === 'cloud' ? 'Sign in' : 'Connect'}</button>}
          </div>
        )
        : undefined}
      <NoteLine note={note}/>
    </Account>
  )
}

const Netflix = ({ backend }: Pick<AccountsProps, 'backend'>) => (
  <Account id="netflix">
    {backend === 'extension'
      ? <div className="actions"><a className="link" href="https://www.netflix.com" target="_blank" rel="noreferrer">Open netflix.com</a></div>
      : <p>Needs the FKN browser extension.</p>}
  </Account>
)

/**
 * The sign-in a source's card holds, with its state and the way out of it where there is one, for the
 * sources stub signs in to on this site; nothing for the others. `heading` is the card's.
 */
export const SourceAccount = ({ origin, heading, backend, sites, status, ...streaming }: AccountsProps & { origin: string, heading: Heading }) => {
  const playing = STREAMING_SITES.find(entry => entry.origin === origin)
  if (playing) return <Streaming {...playing} account={streaming[playing.site]} heading={heading} backend={backend} status={status}/>
  const tracking = TRACKER_SITES.find(entry => entry.site === origin)
  if (tracking) return <Tracker {...tracking} heading={heading} backend={backend} sites={sites} status={status}/>
  return origin === 'nf' ? <Netflix backend={backend}/> : null
}
