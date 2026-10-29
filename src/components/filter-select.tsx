import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { useId, useMemo, useState } from 'preact/hooks'
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
    text-align: left;
    transition: border-color 0.15s, background 0.15s;
  }

  .control:hover { border-color: rgba(255, 255, 255, 0.3); }
  .control.open { border-color: rgba(255, 255, 255, 0.5); }

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
    text-align: left;
    cursor: pointer;
  }

  .option:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
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
  const labelId = useId()

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
        {...getReferenceProps()}
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
                        onInput={event => setTerm(event.currentTarget.value)}
                      />
                    </div>
                  )
                }
                <div className="options">
                  {
                    shown.length
                      ? shown.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={selected.includes(option.value)}
                          className={selected.includes(option.value) ? 'option selected' : 'option'}
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
