import { css } from '@emotion/react'
import { autoUpdate, flip, offset, useFloating, useMergeRefs } from '@floating-ui/react'
import { Frown, Meh, Smile, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'

import { PICKS, written } from '../tracking/compact'
import { isScored, nativeScore } from '../tracking/score-scale'

const FACES = [Frown, Meh, Smile]
const FACE_NAMES = ['bad', 'neutral', 'good']
const OUT_OF: Record<string, number> = { POINT_3: 3, POINT_5: 5, POINT_10: 10, POINT_10_DECIMAL: 10, POINT_100: 100 }

const style = css`
  position: relative;
  display: flex;

  .menu {
    /* over the description below, inside the row; not a page layer */
    z-index: 1;
    width: max-content;
    max-width: 24rem;
    padding: 0.8rem;
    border-radius: 0.8rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: #17171a;
    box-shadow: 0 1.2rem 3rem rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .grid { display: grid; grid-template-columns: repeat(5, 3.4rem); gap: 0.4rem; }
  .grid.faces { grid-template-columns: repeat(3, 3.4rem); }
  .grid button { justify-content: center; padding: 0; }
  .grid button[aria-pressed='true'] { background: #facc15; border-color: #facc15; color: #000; }
  .caption { font-size: 1.2rem; color: rgba(255, 255, 255, 0.6); }
  .exact { display: flex; align-items: center; gap: 0.6rem; font-size: 1.2rem; color: rgba(255, 255, 255, 0.6); }
  .exact input { width: 7rem; }
`

/** A 0 to 100 score as the star shows it on `scale`: a number, or a face on three points. */
export const ScoreFace = ({ score, scale, size = 16 }: { score: number, scale: string, size?: number }) => {
  const value = nativeScore(score, scale)
  if (scale === 'POINT_3') {
    const Face = FACES[value - 1] ?? Meh
    return <Face size={size} aria-hidden="true"/>
  }
  return <span className="value">{value}</span>
}

const nameOf = (score: number, scale: string) => {
  const value = nativeScore(score, scale)
  return scale === 'POINT_3' ? `${value} out of 3 (${FACE_NAMES[value - 1]})` : `${value} out of ${OUT_OF[scale] ?? 100}`
}

/**
 * The star that scores a media, and its menu of the scores `scale` can hold. A pick is written at once,
 * as the 0 to 100 value that lands on its face on that scale; "No score" clears it everywhere.
 */
const ScorePicker = (
  { score, scale, mixed, disabled, disabledTitle, onPick }:
  { score: number | null, scale: string, mixed: boolean, disabled: boolean, disabledTitle?: string, onPick: (score: number | null) => void }
) => {
  const [open, setOpen] = useState(false)
  const [exact, setExact] = useState('')
  const root = useRef<HTMLSpanElement>(null)
  const star = useRef<HTMLButtonElement>(null)
  // over the star when there is no room under it: a tracker's card is fixed, so nothing would scroll
  // a menu running off its bottom into view
  const { refs, floatingStyles } = useFloating({
    open,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 })],
  })
  const starRef = useMergeRefs([star, refs.setReference])
  const scored = isScored(score)
  const current = scored ? nativeScore(score, scale) : undefined

  const close = () => {
    setOpen(false)
    star.current?.focus()
  }
  const pick = (value: number | null) => {
    onPick(value)
    close()
  }

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('.menu button[aria-pressed="true"], .menu button')?.focus()
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step || (event.target as HTMLElement).tagName === 'INPUT') return
    const options = [...root.current!.querySelectorAll<HTMLElement>('.menu button, .menu input')]
    const at = options.indexOf(document.activeElement as HTMLElement)
    options[(at + step + options.length) % options.length]?.focus()
    event.preventDefault()
  }

  const decimal = scale === 'POINT_10_DECIMAL'
  const commitExact = () => {
    const value = Number(exact)
    if (exact === '' || !Number.isFinite(value)) return
    pick(written(Math.min(100, Math.max(1, decimal ? Math.round(value * 10) : Math.round(value))), scale))
  }

  return (
    <span css={style} ref={root}>
      <button
        ref={starRef}
        type="button"
        className="star"
        aria-label={`Score, ${scored ? nameOf(score, scale) : 'none'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={disabled ? disabledTitle : undefined}
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
      >
        <Star size={18} aria-hidden="true" fill={scored ? '#facc15' : 'none'} color={scored ? '#facc15' : 'rgba(255, 255, 255, 0.45)'}/>
        {scored ? <ScoreFace score={score} scale={scale}/> : undefined}
      </button>
      {open
        ? (
          <div ref={refs.setFloating} style={floatingStyles} className="menu" role="dialog" aria-label="Score" onKeyDown={onKeyDown}>
            <div className={`grid${scale === 'POINT_3' ? ' faces' : ''}`}>
              {PICKS[scale]!.map((value, index) => {
                const native = nativeScore(value, scale)
                const Face = FACES[index]
                return (
                  <button key={value} type="button" aria-label={nameOf(value, scale)} aria-pressed={current === native} onClick={() => pick(written(value, scale))}>
                    {scale === 'POINT_3' && Face ? <Face size={16} aria-hidden="true"/> : scale === 'POINT_100' ? value / 10 : native}
                  </button>
                )
              })}
            </div>
            {scale === 'POINT_100' || decimal
              ? (
                <label className="exact">
                  Exact
                  <input
                    type="number"
                    name="score-exact"
                    min={decimal ? 0.1 : 1}
                    max={decimal ? 10 : 100}
                    step={decimal ? 0.1 : 1}
                    value={exact}
                    onInput={event => setExact(event.currentTarget.value)}
                    onKeyDown={event => { if (event.key === 'Enter') commitExact() }}
                  />
                </label>
              )
              : undefined}
            {mixed ? <span className="caption">Out of {OUT_OF[scale]}, the finest scale every checked list keeps</span> : undefined}
            {scored ? <button type="button" onClick={() => pick(null)}>No score</button> : undefined}
          </div>
        )
        : undefined}
    </span>
  )
}

export default ScorePicker
