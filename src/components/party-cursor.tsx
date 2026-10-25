import { defaultName } from '@banou/social/names'
import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useLocation, useSearch } from 'wouter'

import { party } from '../party'
import { useParty, usePartyMessages } from '../party/use-party'
import { layer } from '../layers'

// Where the host is pointing, drawn on every follower's page. Mounted once at the router root.

/** The most cursor messages a host sends per second. Shares the member's ten with scroll and the heartbeats. */
const CURSOR_HZ = 4
/** How long a ghost cursor lingers after the host's last move, so a still hand is not a vanished one. */
const LINGER_MS = 2_500

const style = css`
  position: fixed;
  left: 0;
  top: 0;
  z-index: ${layer.partyCursor};
  pointer-events: none;
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  transform: translate(var(--x), var(--y));
  transition: transform 0.12s linear, opacity 0.3s;
  will-change: transform;

  svg {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }

  .tag {
    margin-top: 1.4rem;
    padding: 0.2rem 0.6rem;
    border-radius: 0.4rem;
    background: #4ade80;
    color: #06120a;
    font-size: 1.1rem;
    font-weight: 600;
    white-space: nowrap;
  }
`

const PartyCursor = () => {
  const state = useParty()
  const role = state.status === 'active' ? state.role : undefined
  const [location] = useLocation()
  const search = useSearch()
  const path = search ? `${location}?${search}` : location

  // The host: where the pointer is, as fractions of the viewport, no more than CURSOR_HZ a second and
  // never while its player runs, since a pointer over a playing video says nothing worth the budget.
  useEffect(() => {
    if (role !== 'host') return
    let last = 0
    let pending: ReturnType<typeof setTimeout> | undefined
    let latest: { x: number, y: number } | undefined
    const flush = () => {
      pending = undefined
      if (!latest || party.playing()) return
      last = Date.now()
      party.send({ t: 'cursor', x: latest.x, y: latest.y })
    }
    const onMove = (event: PointerEvent) => {
      latest = {
        x: Math.min(1, Math.max(0, event.clientX / window.innerWidth)),
        y: Math.min(1, Math.max(0, event.clientY / window.innerHeight)),
      }
      if (pending) return
      pending = setTimeout(flush, Math.max(0, 1000 / CURSOR_HZ - (Date.now() - last)))
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (pending) clearTimeout(pending)
    }
  }, [role])

  // The guest: a ghost at the last position, shown while the host keeps moving and the party is on
  // this page, and hidden the moment the host's player runs.
  const [ghost, setGhost] = useState<{ x: number, y: number, at: number } | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const playing = useRef(false)
  usePartyMessages(message => {
    if (role !== 'guest') return
    if (message.t === 'playback' || (message.t === 'state' && message.s)) {
      const s = message.t === 'playback' ? message.s : message.s!
      playing.current = !s.paused
      if (playing.current) setGhost(undefined)
      return
    }
    if (message.t !== 'cursor' || playing.current) return
    if (party.hostPath() !== path) return
    setGhost({ x: message.x, y: message.y, at: Date.now() })
  })
  useEffect(() => {
    if (!ghost) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [ghost])

  if (role !== 'guest' || !ghost || state.status !== 'active' || now - ghost.at > LINGER_MS) return null
  // what the host calls itself, which everyone repeats on a heartbeat, rather than only what it has
  // said in the chat
  const name = party.nameOf(state.owner) ?? defaultName(state.owner)
  return (
    <div
      css={style}
      style={{ '--x': `${ghost.x * 100}vw`, '--y': `${ghost.y * 100}vh` } as Record<string, string>}
      aria-hidden="true"
    >
      <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
        <path d="M2 2 L2 17 L6.5 13 L9.5 20 L12 19 L9 12.5 L15 12 Z" fill="#4ade80" stroke="#06120a" strokeWidth="1.2" strokeLinejoin="round"/>
      </svg>
      <span className="tag">{name}</span>
    </div>
  )
}

export default PartyCursor
