import type { ComponentChildren } from 'preact'
import type { WindowSignIn } from '../../sources/login-window'
import type { TrackerSite } from '../../tracking/site-sessions'
import type { DisconnectOutcome } from '../../utils/account-session'
import type { FknBackend } from '../../utils/fkn-backend'
import type { AccountInfo } from '../../utils/use-account'

import { useEffect, useRef, useState } from 'preact/hooks'

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
  /** Called after anything here changed what stub keeps. */
  onChange?: () => void
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

const Row = ({ id, title, state, on, children }: { id: string, title: string, state?: string, on?: boolean, children: ComponentChildren }) => (
  <div className="row account" data-account={id}>
    <div className="head">
      <h3>{title}</h3>
      {state ? <span className={`state${on ? ' on' : ''}`}>{state}</span> : undefined}
    </div>
    {children}
  </div>
)

const NoteLine = ({ note }: { note: Note | undefined }) =>
  note ? <p className={`note${note.error ? ' error' : ''}`} role="status">{note.text}</p> : null

/** Keeps a note from landing on a row that is gone. */
const useMounted = () => {
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  return mounted
}

const FknRow = ({ account, onChange }: Pick<AccountsProps, 'account' | 'onChange'>) => {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>()
  const mounted = useMounted()
  const { info, ready } = account

  const disconnect = () => {
    setBusy(true)
    setNote(undefined)
    void account.logout()
      .then(outcome => {
        if (!mounted.current) return
        if (outcome === 'timeout') setNote({ text: 'FKN did not answer, so stub cannot tell whether you were disconnected. Try again.', error: true })
        onChange?.()
      })
      .finally(() => { if (mounted.current) setBusy(false) })
  }

  return (
    <Row id="fkn" title="FKN account" state={!ready ? 'Checking...' : info ? undefined : 'Not connected'}>
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
            <button type="button" className="secondary" disabled={busy} onClick={disconnect}>{busy ? 'Disconnecting...' : 'Disconnect'}</button>
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

const CrunchyrollRow = ({ backend, crunchyroll }: Pick<AccountsProps, 'backend' | 'crunchyroll'>) => {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>()
  const mounted = useMounted()

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
    <Row id="crunchyroll" title="Crunchyroll">
      <p>Plays Crunchyroll episodes on your own Crunchyroll account.</p>
      {backend === 'cloud'
        ? (
          <>
            <p>
              {CLOUD_JAR} stub does not check it here, since that loads a Crunchyroll page: the player says
              when you are signed out.
            </p>
            <div className="actions">
              <button type="button" disabled={busy} onClick={signIn}>{busy ? 'Signing in...' : 'Sign in'}</button>
              <ConfirmAction
                label="Sign out"
                confirmLabel="Yes, sign out"
                busyLabel="Signing out..."
                question={`Sign out of Crunchyroll? This removes its cookies from FKN's jar, which signs every fkn.app app out of Crunchyroll. ${notTold('Crunchyroll')}`}
                onConfirm={signOut}
              />
            </div>
          </>
        )
        : backend === 'extension'
          ? (
            <>
              <p>With the FKN extension, stub plays it on your browser's own crunchyroll.com session and keeps nothing of it. Sign in and out on crunchyroll.com.</p>
              <div className="actions"><a className="link" href="https://www.crunchyroll.com" target="_blank" rel="noreferrer">Open crunchyroll.com</a></div>
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

const TrackerRow = ({ site, name, host, backend, sites, onChange }: { site: TrackerSite, name: string, host: string } & Pick<AccountsProps, 'backend' | 'sites' | 'onChange'>) => {
  const [connected, setConnected] = useState(() => sites.isConnected(site))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>()
  const mounted = useMounted()

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
    <Row id={site} title={name} state={connected ? 'Connected on this device' : 'Not connected'} on={connected}>
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
                  confirmLabel={backend === 'cloud' ? 'Yes, sign out' : 'Yes, disconnect'}
                  busyLabel={backend === 'cloud' ? 'Signing out...' : 'Disconnecting...'}
                  question={backend === 'cloud'
                    ? `Sign out of ${name}? stub stops using it on this device, and its cookies leave FKN's jar, which signs every fkn.app app out of ${name}. ${notTold(name)}`
                    : `Disconnect ${name}? stub stops using your ${host} session on this device. You stay signed in on ${host}.`}
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
export const AccountsSection = ({ account, backend, crunchyroll, sites, onChange }: AccountsProps) => (
  <div className="rows">
    <FknRow account={account} onChange={onChange}/>
    <CrunchyrollRow backend={backend} crunchyroll={crunchyroll}/>
    {TRACKER_SITES.map(entry => <TrackerRow key={entry.site} {...entry} backend={backend} sites={sites} onChange={onChange}/>)}
    <NetflixRow backend={backend}/>
  </div>
)
