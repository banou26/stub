import type { RefObject } from 'preact'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'

/**
 * A button whose action runs only once the viewer answered yes to `question`, asked in place under it.
 * `label` is the button's text and `name` what a screen reader calls the button and the question, naming
 * what they act on ("Clear API keys"); it defaults to the label.
 *
 * Opening the question focuses Cancel, so a second Enter never confirms. Cancel gives focus back to the
 * button. A confirm gives it to `home`, the row's heading, since the action can take the button away
 * (a cleared row offers no Clear, a signed out site offers Sign in), and so does the question going away
 * while it waits. Focus the viewer already moved elsewhere is left where it is. With no `home`, a confirm
 * gives focus back to the button.
 *
 * `onConfirm` may reject: the caller shows what went wrong, and the question closes either way.
 */
export const ConfirmAction = ({ label, name = label, confirmLabel, busyLabel, question, onConfirm, home }: {
  label: string
  name?: string
  confirmLabel: string
  busyLabel: string
  question: string
  onConfirm: () => Promise<unknown> | void
  home?: RefObject<HTMLElement>
}) => {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const giveBack = useRef(false)
  const mounted = useRef(true)
  const questionId = useId()

  // a focused button that turns disabled can leave focus on the body, which still counts as the question's
  const holdsFocus = () => {
    const active = document.activeElement
    return !active || active === document.body || Boolean(group.current?.contains(active))
  }

  useEffect(() => () => {
    mounted.current = false
    if (group.current && holdsFocus()) home?.current?.focus()
  }, [])
  // before paint, so a key pressed right after opening already lands on Cancel
  useLayoutEffect(() => {
    if (asking) cancel.current?.focus()
    else if (giveBack.current) trigger.current?.focus()
    giveBack.current = false
  }, [asking])

  if (!asking) {
    return (
      <button ref={trigger} type="button" className="secondary" aria-label={name === label ? undefined : name} onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }

  const close = () => {
    giveBack.current = true
    setAsking(false)
  }

  const confirm = () => {
    setBusy(true)
    Promise.resolve()
      .then(onConfirm)
      .catch(() => {})
      .finally(() => {
        if (!mounted.current) return
        const owned = holdsFocus()
        setBusy(false)
        setAsking(false)
        if (!owned) return
        if (home?.current) home.current.focus()
        else giveBack.current = true
      })
  }

  return (
    <div ref={group} className="confirm" role="group" aria-label={name}>
      <p id={questionId}>{question}</p>
      <div className="actions">
        <button type="button" className="danger" aria-describedby={questionId} disabled={busy} onClick={confirm}>{busy ? busyLabel : confirmLabel}</button>
        <button ref={cancel} type="button" className="secondary" aria-describedby={questionId} disabled={busy} onClick={close}>Cancel</button>
      </div>
    </div>
  )
}
