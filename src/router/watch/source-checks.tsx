import type { SourceCheck } from '../../plugin-api'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import OriginIcon from '../../components/origin-icon'
import { passSourceCheck } from '../../sources/source-check'
import { remoteCheck, searchAgain } from '../../worker'

const style = css`
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.6rem;

  li {
    display: flex;
    align-items: center;
    gap: 1.1rem;
    min-width: 17rem;
    padding-block: 0.8rem;
    padding-inline: 1.1rem 0.8rem;
    background: rgb(28, 28, 30);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1rem;
  }

  .icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 3.2rem;
    height: 3.2rem;
    border-radius: 0.7rem;
    background: rgba(255, 255, 255, 0.06);
    font-size: 1.6rem;
    font-weight: 700;
    text-transform: uppercase;
    overflow: hidden;

    img { width: 100%; height: 100%; object-fit: contain; padding: 0.45rem; box-sizing: border-box; }
  }

  .name {
    flex: 1;
    font-size: 1.45rem;
    font-weight: 600;
  }

  button {
    padding: 0.6rem 1.4rem;
    border: none;
    border-radius: 0.6rem;
    background: #fff;
    color: #000;
    font-family: inherit;
    font-size: 1.3rem;
    font-weight: 600;
    cursor: pointer;

    &:disabled { opacity: 0.6; cursor: default; }
  }
`

type Source = { origin: string, name: string, icon?: string | null }

/**
 * A prompt for each of `sources` whose site asks the viewer to pass a check: the source's name and one button. Hand it
 * the sources whose search has settled, since each is asked as it joins. The button opens the check in a window, and
 * once that window is done, passed or closed, the source is searched again and asked again.
 */
const SourceChecks = ({ sources }: { sources: readonly Source[] }) => {
  const intl = useIntl()
  const [checks, setChecks] = useState<Record<string, SourceCheck>>({})
  const [open, setOpen] = useState<string>()
  const ask = (origin: string) => remoteCheck(origin).catch(() => undefined).then(check => {
    setChecks(current => {
      const next = { ...current }
      if (check) next[origin] = check
      else delete next[origin]
      return next
    })
  })
  const origins = sources.map(({ origin }) => origin).join(',')
  useEffect(() => {
    if (origins) for (const origin of origins.split(',')) void ask(origin)
  }, [origins])

  const pass = (origin: string, check: SourceCheck) => {
    const passing = passSourceCheck(check)
    setOpen(origin)
    void passing.catch(() => undefined).then(async outcome => {
      if (outcome === 'authed' || outcome === 'closed') {
        await searchAgain(origin).catch(() => {})
        await ask(origin)
      }
      setOpen(undefined)
    })
  }

  const shown = sources.filter(({ origin }) => checks[origin])
  if (!shown.length) return null
  return (
    <ul css={style}>
      {shown.map(({ origin, name, icon }) => (
        <li key={origin} data-check={origin}>
          <span className="icon"><OriginIcon icon={icon} name={name}/></span>
          <span className="name" id={`check-${origin}`}>{name}</span>
          <button type="button" aria-describedby={`check-${origin}`} disabled={open === origin} onClick={() => pass(origin, checks[origin]!)}>
            {intl.formatMessage({ id: 'Verify', defaultMessage: 'Verify' })}
          </button>
        </li>
      ))}
    </ul>
  )
}

export default SourceChecks
