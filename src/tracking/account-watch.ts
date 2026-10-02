// The page's half of the stub tracker's account link: the worker hears of an account change itself, but
// cannot see the page start, go back online or come into view, so the page tells it. Import free, so a
// test hands it a fake page.

type Target = { addEventListener: (type: string, listener: () => void) => void }

/**
 * Tells the worker to check the account at once and on every return online, and to refresh when the
 * page comes back into view and every `intervalMs` while it stays in view. The worker decides what each
 * costs: a refresh reads the account no sooner than its own limit allows.
 */
export const watchTrackerAccount = ({
  check,
  focused,
  page = globalThis as unknown as Target,
  document: doc = globalThis.document,
  intervalMs = 60_000,
}: {
  check: () => Promise<unknown>
  focused: () => Promise<unknown>
  page?: Target
  document?: Target & { visibilityState: string }
  intervalMs?: number
}) => {
  const run = (step: () => Promise<unknown>) => () => { step().catch(error => console.warn('tracking: account link', error)) }
  const visible = () => doc?.visibilityState !== 'hidden'
  const checked = run(check)
  const back = run(focused)

  checked()
  page.addEventListener('online', checked)
  page.addEventListener('focus', back)
  doc?.addEventListener('visibilitychange', () => { if (visible()) back() })
  const timer = setInterval(() => { if (visible()) back() }, intervalMs)
  return () => clearInterval(timer)
}
