import type { Participant } from '../social'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'

const avatarStyle = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
  font-weight: 700;
  line-height: 1;
  user-select: none;

  &[data-status='friend'] {
    border-color: rgba(74, 222, 128, 0.45);
  }

  &[data-status='rekeyed'] {
    border-color: rgba(251, 146, 60, 0.55);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`

const safeAvatarSrc = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.startsWith('data:image/') ? trimmed : null
}

const initialOf = (participant: Participant) => {
  const identity = participant.identity!
  const source = (participant.status === 'friend' ? identity.nickname?.trim() : undefined) || identity.displayName.trim() || identity.name
  return ([...source.normalize('NFC')][0] ?? '?').toUpperCase()
}

/**
 * Verified FKN Social avatar (uploaded image or deterministic identicon, with initial fallback).
 * Renders nothing when no verified social identity is held, keeping signed-out UI unchanged.
 */
const PartyAvatar = ({ participant, size = 24 }: { participant?: Participant, size?: number }) => {
  const identity = participant?.identity ?? null
  const safeAvatar = safeAvatarSrc(identity?.avatar)
  const safeIdenticon = safeAvatarSrc(identity?.identicon)
  const primary = safeAvatar ?? safeIdenticon
  const fallback = safeAvatar ? safeIdenticon : null
  const [failedPrimary, setFailedPrimary] = useState(false)
  const [failedFallback, setFailedFallback] = useState(false)

  useEffect(() => {
    setFailedPrimary(false)
    setFailedFallback(false)
  }, [primary, fallback])

  if (!participant || !identity) return null

  const src = !failedPrimary ? primary : !failedFallback ? fallback : null
  const rem = `${size / 10}rem`

  return (
    <span
      css={avatarStyle}
      className="party-avatar"
      data-status={participant.status}
      style={{ width: rem, height: rem, fontSize: `${Math.max(0.9, size / 22)}rem` }}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => {
            if (!failedPrimary) setFailedPrimary(true)
            else setFailedFallback(true)
          }}
        />
      ) : (
        <span>{initialOf(participant)}</span>
      )}
    </span>
  )
}

export default PartyAvatar
