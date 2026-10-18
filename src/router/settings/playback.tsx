import { css } from '@emotion/react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

import { switchStyle } from '../../components/switch-style'
import { builtInSources } from '../../sources/built-in'
import { readDisabledSources, watchDisabledSources } from '../../sources/disabled-sources'
import { DEFAULT_PLAY_ORDER, moved, playOrder, readPlayOrder, watchPlayOrder, writePlayOrder } from '../../sources/play-order'
import { readAutoplay, setAutoplay, watchAutoplay } from '../../utils/autoplay'
import { usePluginStatuses } from '../../utils/use-plugin-statuses'

const card = `
  max-width: 52rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.8rem;
  background: rgba(255, 255, 255, 0.02);
  font-size: 1.5rem;
  font-weight: 600;
  color: #fff;
`

const style = css`
  label.autoplay {
    ${card}
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    padding: 1.4rem 1.6rem;
    cursor: pointer;
    transition: border-color 0.15s;

    &:hover { border-color: rgba(255, 255, 255, 0.25); }
  }

  h3.part {
    margin: 3.2rem 0 0.6rem;
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
  }

  ol.play-order {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: rank;
  }

  ol.play-order li {
    ${card}
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 0.8rem 0.8rem 1.6rem;
    counter-increment: rank;

    &::before {
      content: counter(rank);
      min-width: 1.6rem;
      color: rgba(255, 255, 255, 0.45);
      font-variant-numeric: tabular-nums;
    }
  }

  ol.play-order .name {
    min-width: 0;
    margin-right: auto;
    overflow-wrap: anywhere;
  }

  ol.play-order button {
    display: grid;
    place-items: center;
    width: 3.6rem;
    height: 3.6rem;
    padding: 0;
    flex: none;

    svg { width: 1.8rem; height: 1.8rem; }
  }

  ol.play-order button[aria-disabled='true'] { opacity: 0.35; cursor: default; }
`

const PLAYERS = new Map(builtInSources.filter(source => DEFAULT_PLAY_ORDER.includes(source.origin)).map(source => [source.origin, source.name]))

/** stub's players and the added sources, in the order Play tries them, without the ones turned off. */
const PlayOrder = () => {
  const [kept, setKept] = useState(readPlayOrder)
  const [disabled, setDisabled] = useState(readDisabledSources)
  useEffect(() => watchPlayOrder(() => setKept(readPlayOrder())), [])
  useEffect(() => watchDisabledSources(() => setDisabled(readDisabledSources())), [])
  const names = new Map([
    ...PLAYERS,
    ...usePluginStatuses().flatMap(plugin => plugin.state === 'connected' ? plugin.sources?.map(source => [source.origin, source.name] as const) ?? [] : []),
  ])
  const order = playOrder(kept, [...names.keys()])
  const shown = order.filter(origin => names.has(origin) && !disabled.includes(origin))
  // a keyed row moved in the DOM loses the focus, so the pressed button takes it back; the end buttons stay
  // focusable for it
  const pressed = useRef<HTMLButtonElement | undefined>(undefined)
  useLayoutEffect(() => {
    pressed.current?.focus()
    pressed.current = undefined
  })

  const button = (origin: string, step: -1 | 1, at: number) => {
    const end = step < 0 ? at === 0 : at === shown.length - 1
    return (
      <button
        type="button"
        className="secondary"
        aria-label={`Move ${names.get(origin)} ${step < 0 ? 'up' : 'down'}`}
        aria-disabled={end ? true : undefined}
        onClick={event => {
          if (end) return
          pressed.current = event.currentTarget
          writePlayOrder(moved(order, origin, step, shown))
        }}
      >
        {step < 0 ? <ChevronUp/> : <ChevronDown/>}
      </button>
    )
  }

  return (
    <ol className="play-order">
      {shown.map((origin, at) => (
        <li key={origin} data-play-order={origin}>
          <span className="name">{names.get(origin)}</span>
          {button(origin, -1, at)}
          {button(origin, 1, at)}
        </li>
      ))}
    </ol>
  )
}

/** The player's settings: whether an episode's end opens the next one by itself, and the order Play tries sources in. */
export const PlaybackSection = () => {
  const [on, setOn] = useState(readAutoplay)
  useEffect(() => watchAutoplay(() => setOn(readAutoplay())), [])
  return (
    <div css={style}>
      <label className="autoplay">
        Autoplay next episode
        <input
          type="checkbox"
          role="switch"
          css={switchStyle}
          checked={on}
          onChange={event => {
            const checked = (event.target as HTMLInputElement).checked
            setAutoplay(checked)
            setOn(checked)
          }}
        />
      </label>
      <h3 className="part">Play order</h3>
      <PlayOrder/>
    </div>
  )
}
