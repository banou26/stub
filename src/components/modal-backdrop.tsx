import type { HTMLAttributes } from 'react'

import { useEffect, useRef } from 'preact/hooks'
import { FloatingFocusManager, FloatingOverlay, FloatingPortal, useClick, useFloating, useInteractions } from '@floating-ui/react'

/**
 * A modal over the page: a backdrop that locks the page's scroll and calls `onClose` on a press on
 * itself or on Escape, never on one inside the modal (its `.modal` box), with focus kept inside and
 * starting on that box rather than on its first control. It takes no Space/Enter keys, so Space
 * still reaches the controls inside, a check box among them.
 */
const ModalBackdrop = (
  { label, labelledBy, onClose, children, ...rest }:
  HTMLAttributes<HTMLDivElement> & { label?: string, labelledBy?: string, onClose: () => void }
) => {
  const { refs, context, elements } = useFloating({
    open: true,
    onOpenChange: (_, event) => {
      if (event?.target === refs.reference.current) onClose()
    },
  })
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const el = elements.floating
    if (!el) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
      }
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [elements.floating])
  // useClick's key handlers would take Space from every control inside that is not a button
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context, { keyboardHandlers: false })])
  const { onKeyDown: _onKeyDown, onKeyUp: _onKeyUp, ...backdropProps } = getReferenceProps() as Record<string, unknown>
  return (
    <FloatingPortal>
      <FloatingOverlay lockScroll {...rest} ref={refs.setReference} {...backdropProps}>
        <FloatingFocusManager context={context} initialFocus={refs.floating}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            aria-labelledby={labelledBy}
            tabIndex={-1}
            ref={refs.setFloating}
            {...getFloatingProps()}
          >
            {children}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  )
}

export default ModalBackdrop
