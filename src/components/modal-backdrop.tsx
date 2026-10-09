import type { HTMLAttributes } from 'react'

import { FloatingFocusManager, FloatingOverlay, FloatingPortal, useClick, useFloating, useInteractions } from '@floating-ui/react'

/**
 * A modal over the page: a backdrop that locks the page's scroll and calls `onClose` on a press on
 * itself, never on one inside the modal (its `.modal` box), with focus kept inside. It takes no keys,
 * so Space still reaches the controls inside, a check box among them.
 */
const ModalBackdrop = ({ onClose, children, ...rest }: HTMLAttributes<HTMLDivElement> & { onClose: () => void }) => {
  const { refs, context } = useFloating({
    open: true,
    onOpenChange: (_, event) => {
      if (event?.target === refs.reference.current) onClose()
    },
  })
  // useClick's key handlers would take Space from every control inside that is not a button
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context, { keyboardHandlers: false })])
  return (
    <FloatingPortal>
      <FloatingOverlay lockScroll {...rest} ref={refs.setReference} {...getReferenceProps()}>
        <FloatingFocusManager context={context}>
          <div className="modal" ref={refs.setFloating} {...getFloatingProps()}>
            {children}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  )
}

export default ModalBackdrop
