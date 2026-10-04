import type { AttachCookies } from '@fkn/lib'

import { isExtensionExposed } from '@fkn/lib'

/** The FKN backend an attachment runs on: the browser extension, or the cloud render proxy. */
export type FknBackend = 'extension' | 'cloud'

/**
 * The extension once it exposed itself, the cloud otherwise. Read again after the page loaded and
 * 300 ms more, so an extension that exposes itself late still counts, as @fkn/lib's own router
 * waited before 0.9.42.
 */
export const detectBackend = async (): Promise<FknBackend> => {
  if (isExtensionExposed()) return 'extension'
  if (document.readyState !== 'complete') {
    await new Promise<void>(resolve => {
      const onLoad = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        window.removeEventListener('load', onLoad)
        resolve()
      }, 10_000)
      window.addEventListener('load', onLoad, { once: true })
    })
  }
  await new Promise(r => setTimeout(r, 300))
  return isExtensionExposed() ? 'extension' : 'cloud'
}

/**
 * `attachFrame`'s `cookies` for a backend. Since @fkn/lib 0.9.42 that option picks the backend, so the
 * caller decides and the jar follows: the browser's own cookies on the extension, the app's kept cloud
 * jar on the cloud, the two jars stub ran on before.
 */
export const attachCookies = (backend: FknBackend): AttachCookies =>
  backend === 'extension' ? 'native' : 'persistent'
