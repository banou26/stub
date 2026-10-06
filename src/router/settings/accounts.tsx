import type { ComponentChildren, RefObject } from 'preact'
import type { WindowSignIn } from '../../sources/login-window'
import type { TrackerSite } from '../../tracking/site-sessions'
import type { SiteState, SiteStatus, StatusSite } from '../../tracking/site-status'
import type { DisconnectOutcome } from '../../utils/account-session'
import type { FknBackend } from '../../utils/fkn-backend'
import type { AccountInfo } from '../../utils/use-account'

import { useEffect, useRef, useState } from 'preact/hooks'

import { formatCountdown } from '../../utils/countdown'
import { ConfirmAction } from './confirm'

export type { TrackerSite }

/**
 * What the Accounts section reaches, handed in so the section renders and acts the same over fakes.
 * `backend` is undefined until it is known whether the extension runs here, and no site offers an
 * action until then: what a sign out does depends on it.
 */
export type AccountsProps = {
  account: { info: AccountInfo, ready: boolean, logout: () => Promise<DisconnectOutcome> }
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
    /** Asks the site now and remembers its answer. Rejects when the answer says neither. */
    check: (site: StatusSite, backend: FknBackend) => Promise<SiteState>
  }
  /** Called after anything here changed what stub keeps. */
  onChange?: () => void
  /** The clock a remembered state's age is read against. */
  now?: () => number
}

const MANAGE_URL = 'https://fkn.app/account'

type Note = { text: string, error?: boolean }

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

const signInNote = (name: string, outcome: WindowSignIn): Note => {
  switch (outcome) {
    case 'authed': return { text: `Signed in to ${name}.` }
    case 'closed': return { text: 'The sign-in window closed. If you finished signing in there, stub reads it from now on.' }
    case 'blocked': return { text: 'The browser blocked the sign-in window. Allow pop-ups for this page and try again.', error: true }
    case 'unsupported': return { text: `Connected to your browser's own ${name} session.` }
  }
}

const STATE_LABEL: Record<SiteState, string> = { 'signed-in': 'Signed in', 'signed-out': 'Signed out' }

const stateText = (status: SiteStatus, now: number) => {
  const ago = formatCountdown(now - status.checkedAt, 1)
  return `${STATE_LABEL[status.state]}, checked ${ago ? `${ago} ago` : 'just now'}`
}

/** The site's remembered state, read again whenever stub records a new one. */
const useSiteStatus = (status: AccountsProps['status'], site: StatusSite) => {
  const [, setRevision] = useState(0)
  useEffect(() => status.watch(site, () => setRevision(revision => revision + 1)), [status, site])
  return status.read(site)
}

const CheckNow = ({ site, name, backend, status, onChange, onNote }: { site: StatusSite, name: string, backend: FknBackend, onNote: (note: Note | undefined) => void } & Pick<AccountsProps, 'status' | 'onChange'>) => {
  const [busy, setBusy] = useState(false)
  const mounted = useMounted()
  const check = () => {
    setBusy(true)
    onNote(undefined)
    status.check(site, backend)
      .then(() => onChange?.())
      .catch(error => { if (mounted.current) onNote({ text: `stub could not tell whether you are signed in to ${name}: ${messageOf(error)}`, error: true }) })
      .finally(() => { if (mounted.current) setBusy(false) })
  }
  return <button type="button" className="secondary" disabled={busy} aria-label={`Check whether you are signed in to ${name}`} onClick={check}>{busy ? 'Checking...' : 'Check now'}</button>
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

const FknRow = ({ account, onChange }: Pick<AccountsProps, 'account' | 'onChange'>) => {
  const [note, setNote] = useState<Note>()
  const mounted = useMounted()
  const heading = useRef<HTMLHeadingElement>(null)
  const { info, ready } = account

  const disconnect = () => {
    setNote(undefined)
    return account.logout().then(outcome => {
      if (!mounted.current) return
      if (outcome === 'timeout') setNote({ text: 'FKN did not answer, so stub cannot tell whether you were disconnected. Try again.', error: true })
      onChange?.()
    })
  }

  return (
    <Row id="fkn" title="FKN account" state={!ready ? 'Checking...' : info ? undefined : 'Not connected'} heading={heading}>
      {info
        ? (
          <p>
            Signed in as <strong>{info.name || 'your account'}</strong>, {info.premium ? 'Premium' : 'Free'}. stub runs on
            FKN, and can keep its list in your account, encrypted in this browser first.
          </p>
        )
        : <p>stub runs on FKN. Connect with the button at the top of the page to keep stub's list in your FKN account.</p>}
      {info
        ? (
          <div className="actions">
            <a className="link" href={MANAGE_URL} target="_blank" rel="noreferrer">Manage on fkn.app</a>
            <ConfirmAction
              label="Disconnect"
              name="Disconnect your FKN account"
              home={heading}
              confirmLabel="Yes, disconnect"
              busyLabel="Disconnecting..."
              question="Disconnect your FKN account? If stub keeps its list in your account, that list leaves this device, and any list changes this device has not sent to the account yet are lost."
              onConfirm={disconnect}
            />
          </div>
        )
        : undefined}
      <NoteLine note={note}/>
    </Row>
  )
}

const CLOUD_JAR = 'Without the FKN extension, the session is kept by FKN, in the cookie jar every fkn.app app shares, and not by stub.'

const notTold = (name: string) =>
  `${name} itself is not told, so the session stays valid there until it expires, held by nobody.`

const CrunchyrollRow = ({ backend, crunchyroll, status, onChange, now }: Pick<AccountsProps, 'backend' | 'crunchyroll' | 'status' | 'onChange'> & { now: () => number }) => {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>()
  const mounted = useMounted()
  const heading = useRef<HTMLHeadingElement>(null)
  const remembered = useSiteStatus(status, 'crunchyroll')
  const checkNow = backend ? <CheckNow site="crunchyroll" name="Crunchyroll" backend={backend} status={status} onChange={onChange} onNote={setNote}/> : undefined

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
    () => { if (mounted.current) setNote({ text: 'Signed out. FKN no longer holds a Crunchyroll session for fkn.app apps.' }) },
    error => { if (mounted.current) setNote({ text: `FKN could not remove the Crunchyroll cookies: ${messageOf(error)}. Try again.`, error: true }) },
  )

  return (
    <Row
      id="crunchyroll"
      title="Crunchyroll"
      state={remembered ? stateText(remembered, now()) : 'Not checked yet'}
      on={remembered?.state === 'signed-in'}
      heading={heading}
    >
      <p>Plays Crunchyroll episodes on your own Crunchyroll account.</p>
      {backend === 'cloud'
        ? (
          <>
            <p>{CLOUD_JAR} Check now asks Crunchyroll whether that session is signed in, without loading a Crunchyroll page.</p>
            <div className="actions">
              <button type="button" disabled={busy} onClick={signIn}>{busy ? 'Signing in...' : 'Sign in'}</button>
              <ConfirmAction
                label="Sign out"
                name="Sign out of Crunchyroll"
                home={heading}
                confirmLabel="Yes, sign out"
                busyLabel="Signing out..."
                question={`Sign out of Crunchyroll? This removes its cookies from FKN's jar, which signs every fkn.app app out of Crunchyroll. ${notTold('Crunchyroll')}`}
                onConfirm={signOut}
              />
              {checkNow}
            </div>
          </>
        )
        : backend === 'extension'
          ? (
            <>
              <p>With the FKN extension, stub plays it on your browser's own crunchyroll.com session and keeps nothing of it. Sign in and out on crunchyroll.com.</p>
              <div className="actions">
                <a className="link" href="https://www.crunchyroll.com" target="_blank" rel="noreferrer">Open crunchyroll.com</a>
                {checkNow}
              </div>
            </>
          )
          : <p>Checking whether the FKN extension runs here...</p>}
      <NoteLine note={note}/>
    </Row>
  )
}

const TRACKER_SITES: { site: TrackerSite, name: string, host: string }[] = [
  { site: 'anilist', name: 'AniList', host: 'anilist.co' },
  { site: 'mal', name: 'MyAnimeList', host: 'myanimelist.net' },
]

const TrackerRow = ({ site, name, host, backend, sites, status, onChange, now }: { site: TrackerSite, name: string, host: string, now: () => number } & Pick<AccountsProps, 'backend' | 'sites' | 'status' | 'onChange'>) => {
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
    if (!mounted.current) return
    setConnected(sites.isConnected(site))
    onChange?.()
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
      if (mounted.current) {
        setNote({
          text: current === 'cloud'
            ? `Signed out. stub no longer uses ${name} on this device, and FKN no longer holds its session.`
            : `Disconnected. To sign out of ${name} itself, sign out on ${host}.`,
        })
      }
      settle()
    },
    error => {
      if (mounted.current) setNote({ text: `Disconnected on this device, but FKN could not remove the ${name} cookies: ${messageOf(error)}. Sign in and out again to retry.`, error: true })
      settle()
    },
  )

  return (
    <Row
      id={site}
      title={name}
      state={!connected ? 'Not connected' : remembered ? stateText(remembered, now()) : 'Connected on this device'}
      on={connected && remembered?.state !== 'signed-out'}
      heading={heading}
    >
      <p>
        Tracks your {name} list with your own {host} session.{' '}
        {backend === 'cloud' ? CLOUD_JAR : backend === 'extension' ? `With the FKN extension, stub uses your browser's own ${host} session.` : ''}
      </p>
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
                  question={backend === 'cloud'
                    ? `Sign out of ${name}? stub stops using it on this device, and its cookies leave FKN's jar, which signs every fkn.app app out of ${name}. ${notTold(name)}`
                    : `Disconnect ${name}? stub stops using your ${host} session on this device. You stay signed in on ${host}.`}
                  onConfirm={() => signOut(backend)}
                />
              )
              : <button type="button" disabled={busy} onClick={signIn}>{busy ? 'Signing in...' : backend === 'cloud' ? 'Sign in' : 'Connect'}</button>}
            {connected ? <CheckNow site={site} name={name} backend={backend} status={status} onChange={onChange} onNote={setNote}/> : undefined}
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
      ? (
        <>
          <p>stub plays Netflix on your browser's own netflix.com session, through the FKN extension, and keeps nothing of it. Sign in and out on netflix.com.</p>
          <div className="actions"><a className="link" href="https://www.netflix.com" target="_blank" rel="noreferrer">Open netflix.com</a></div>
        </>
      )
      : <p>Netflix needs the FKN browser extension: stub plays it on your browser's own netflix.com session, and keeps nothing of it.</p>}
  </Row>
)

/** Every sign-in stub uses, what each is, and the way out of it where there is one. */
export const AccountsSection = ({ account, backend, crunchyroll, sites, status, onChange, now = Date.now }: AccountsProps) => (
  <div className="rows">
    <FknRow account={account} onChange={onChange}/>
    <CrunchyrollRow backend={backend} crunchyroll={crunchyroll} status={status} onChange={onChange} now={now}/>
    {TRACKER_SITES.map(entry => <TrackerRow key={entry.site} {...entry} backend={backend} sites={sites} status={status} onChange={onChange} now={now}/>)}
    <NetflixRow backend={backend}/>
  </div>
)
