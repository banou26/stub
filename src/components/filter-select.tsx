import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useIntl } from 'react-intl'

import { NAME_LIST } from '../i18n'
import { layer } from '../layers'
import {
  autoUpdate, flip, offset, shift, size,
  FloatingFocusManager, FloatingPortal,
  useClick, useDismiss, useFloating, useInteractions, useRole,
} from '@floating-ui/react'

const style = css`
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;

  .label {
    font-size: 1.3rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .control {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    height: 4.2rem;
    padding: 0 1.2rem;
    border-radius: 0.6rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.85);
    font-size: 1.5rem;
    font-family: inherit;
    cursor: pointer;
    text-align: start;
    transition: border-color 0.15s, background 0.15s;
  }

  .control:hover { border-color: rgba(255, 255, 255, 0.3); }
  .control.open { border-color: rgba(255, 255, 255, 0.5); }
  .control:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

  .control .value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .control .value.any { color: rgba(255, 255, 255, 0.4); }

  .control .chevron {
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.4);
    transition: transform 0.15s;
  }

  .control.open .chevron { transform: rotate(180deg); }
`

const menuStyle = css`
  z-index: ${layer.filterMenu};
  width: max-content;
  min-width: 22rem;
  max-width: 34rem;
  padding: 0.6rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: #17171a;
  box-shadow: 0 1.2rem 3rem rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;

  .filter {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0 0.9rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.4);
  }

  .filter input {
    flex: 1;
    min-width: 0;
    height: 3.4rem;
    border: none;
    outline: none;
    background: transparent;
    color: #fff;
    font-size: 1.5rem;
    font-family: inherit;
  }

  .options {
    display: flex;
    flex-direction: column;
    max-height: 32rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 0.9rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.8);
    font-size: 1.5rem;
    font-family: inherit;
    text-align: start;
    cursor: pointer;
  }

  .option:hover, .option.active { background: rgba(255, 255, 255, 0.08); color: #fff; }
  .option:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
  .option.selected { color: #fff; }

  .option .tick {
    flex-shrink: 0;
    width: 1.6rem;
    color: rgba(255, 255, 255, 0.9);
  }

  .option .tick.hidden { visibility: hidden; }

  .empty {
    padding: 1.2rem 0.9rem;
    font-size: 1.4rem;
    color: rgba(255, 255, 255, 0.4);
  }
`

export type FilterOption = { value: string, label: string }

type Props = {
  label: string
  options: readonly FilterOption[]
  /** Everything currently picked. A single-select control simply never holds more than one. */
  selected: readonly string[]
  onChange: (selected: string[]) => void
  multiple?: boolean
  /** A type-to-narrow box, by its label (`Filter year`). Worth it above roughly twenty options, pointless below. */
  searchable?: string
  /** Offer values the option list does not contain, so a url can carry a genre this build never saw. */
  allowCustom?: boolean
}

/**
 * One labelled dropdown in the search page's filter bar.
 *
 * Controlled: it renders `selected` and reports every change, and never holds a copy. The page owns
 * the url, so a control that kept its own state would fight the address bar on a back navigation.
 *
 * Single-select (`multiple` unset) closes on pick and toggles off when the picked value is picked
 * again, which is how the row of chips below the bar can be the only affordance for clearing.
 */
const FilterSelect = ({
  label, options, selected, onChange,
  multiple = false, searchable, allowCustom = false,
}: Props) => {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const labelId = useId()
  const optionId = (index: number) => `${labelId}-option-${index}`

  useEffect(() => {
    if (!open) setActiveIndex(-1)
  }, [open])

  useEffect(() => {
    setActiveIndex(-1)
  }, [term])

  useEffect(() => {
    if (open && activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: next => { setOpen(next); if (!next) setTerm('') },
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      // the menu is never taller than the space under it, so a long genre list scrolls inside itself
      // instead of running off the viewport
      size({ padding: 8, apply: ({ availableHeight, elements }) => {
        elements.floating.style.maxHeight = `${Math.max(160, availableHeight)}px`
      } }),
    ],
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'listbox' }),
  ])

  const labelOf = (value: string) => options.find(option => option.value === value)?.label ?? value
  const summary = intl.formatList(selected.map(labelOf), NAME_LIST)

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase()
    const matching = needle ? options.filter(option => option.label.toLowerCase().includes(needle)) : options
    if (!allowCustom || !needle || matching.some(option => option.label.toLowerCase() === needle)) return matching
    return [{ value: term.trim(), label: term.trim() }, ...matching]
  }, [options, term, allowCustom])

  const toggle = (value: string) => {
    if (!multiple) {
      onChange(selected.includes(value) ? [] : [value])
      setOpen(false)
      setTerm('')
      return
    }
    onChange(selected.includes(value) ? selected.filter(entry => entry !== value) : [...selected, value])
  }

  const handleKeyDown = (event: KeyboardEvent, source: 'trigger' | 'input' | 'option') => {
    if (!open) {
      if (source !== 'trigger') return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(true)
        setActiveIndex(shown.length ? (event.key === 'ArrowDown' ? 0 : shown.length - 1) : -1)
      }
      return
    }
    if (!shown.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      const next = activeIndex < 0 ? 0 : (activeIndex + 1) % shown.length
      setActiveIndex(next)
      if (source === 'option') optionRefs.current[next]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      const next = activeIndex < 0 ? shown.length - 1 : (activeIndex - 1 + shown.length) % shown.length
      setActiveIndex(next)
      if (source === 'option') optionRefs.current[next]?.focus()
    } else if (event.key === 'Home' && source !== 'input') {
      event.preventDefault()
      event.stopPropagation()
      setActiveIndex(0)
      if (source === 'option') optionRefs.current[0]?.focus()
    } else if (event.key === 'End' && source !== 'input') {
      event.preventDefault()
      event.stopPropagation()
      const last = shown.length - 1
      setActiveIndex(last)
      if (source === 'option') optionRefs.current[last]?.focus()
    } else if (event.key === 'Enter' && source !== 'option' && activeIndex >= 0 && shown[activeIndex]) {
      event.preventDefault()
      event.stopPropagation()
      toggle(shown[activeIndex].value)
    }
  }

  const activeDescendant = open && activeIndex >= 0 && shown[activeIndex] ? optionId(activeIndex) : undefined

  return (
    <div css={style}>
      <span className="label" id={labelId}>{label}</span>
      <button
        ref={refs.setReference}
        type="button"
        className={open ? 'control open' : 'control'}
        // named by the visible label rather than aria-label, which would REPLACE the button's text and
        // hide the current selection from a screen reader
        aria-labelledby={labelId}
        {...getReferenceProps({
          onKeyDown: event => handleKeyDown(event as unknown as KeyboardEvent, 'trigger'),
        })}
        aria-activedescendant={searchable === undefined ? activeDescendant : undefined}
      >
        <span className={selected.length ? 'value' : 'value any'}>
          {selected.length ? summary : intl.formatMessage({ id: 'Any#no filter picked', defaultMessage: 'Any', description: 'no filter picked' })}
        </span>
        <ChevronDown size={16} className="chevron"/>
      </button>
      {
        open && (
          <FloatingPortal>
            <FloatingFocusManager context={context} modal={false} initialFocus={searchable === undefined ? -1 : 0}>
              <div ref={refs.setFloating} css={menuStyle} style={floatingStyles} {...getFloatingProps()}>
                {
                  searchable !== undefined && (
                    <div className="filter">
                      <Search size={15}/>
                      <input
                        type="text"
                        value={term}
                        placeholder={searchable}
                        aria-label={searchable}
                        aria-activedescendant={activeDescendant}
                        onInput={event => setTerm(event.currentTarget.value)}
                        onKeyDown={event => handleKeyDown(event, 'input')}
                      />
                    </div>
                  )
                }
                <div className="options">
                  {
                    shown.length
                      ? shown.map((option, index) => (
                        <button
                          key={option.value}
                          id={optionId(index)}
                          ref={element => { optionRefs.current[index] = element }}
                          type="button"
                          role="option"
                          aria-selected={selected.includes(option.value)}
                          className={`option${selected.includes(option.value) ? ' selected' : ''}${index === activeIndex ? ' active' : ''}`}
                          onMouseEnter={() => setActiveIndex(index)}
                          onFocus={() => setActiveIndex(index)}
                          onKeyDown={event => handleKeyDown(event, 'option')}
                          onClick={() => toggle(option.value)}
                        >
                          <Check size={16} className={selected.includes(option.value) ? 'tick' : 'tick hidden'}/>
                          <span>{option.label}</span>
                        </button>
                      ))
                      : <div className="empty">{intl.formatMessage({ id: 'Nothing matches “{term}”.', defaultMessage: 'Nothing matches “{term}”.' }, { term })}</div>
                  }
                </div>
              </div>
            </FloatingFocusManager>
          </FloatingPortal>
        )
      }
    </div>
  )
}

export const FilterField = ({ label, children }: { label: string, children: ComponentChildren }) => (
  <div css={style}>
    <span className="label">{label}</span>
    {children}
  </div>
)

export default FilterSelect
