import { useEffect, useRef, useState } from 'preact/hooks'

/**
 * A button whose action runs only once the viewer answered yes to `question`, asked in place under it.
 * `onConfirm` may reject: the caller shows what went wrong, and the question closes either way.
 */
export const ConfirmAction = ({ label, confirmLabel, busyLabel, question, onConfirm }: {
  label: string
  confirmLabel: string
  busyLabel: string
  question: string
  onConfirm: () => Promise<unknown> | void
}) => {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const yes = useRef<HTMLButtonElement>(null)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  useEffect(() => { if (asking) yes.current?.focus() }, [asking])

  if (!asking) return <button type="button" className="secondary" onClick={() => setAsking(true)}>{label}</button>

  const confirm = () => {
    setBusy(true)
    Promise.resolve()
      .then(onConfirm)
      .catch(() => {})
      .finally(() => {
        if (!mounted.current) return
        setBusy(false)
        setAsking(false)
      })
  }

  return (
    <div className="confirm" role="group" aria-label={label}>
      <p>{question}</p>
      <div className="actions">
        <button ref={yes} type="button" className="danger" disabled={busy} onClick={confirm}>{busy ? busyLabel : confirmLabel}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
      </div>
    </div>
  )
}
