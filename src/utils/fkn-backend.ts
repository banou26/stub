import type { AttachCookies } from '@fkn/lib'

import { isExtensionExposed, promptInstall } from '@fkn/lib'

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

/** Shows FKN's card for installing the extension: true once it is there, false when the viewer dismisses it. */
export const addExtension = (): Promise<boolean> => promptInstall('Play it in stub')

/**
 * Whether this browser can add the FKN extension: Chromium or Firefox on a computer, the browsers its two
 * stores serve. Not a phone or a tablet; an iPad asking for the desktop site reads as a Mac with a touch
 * screen.
 */
export const canAddExtension = ({ userAgent, maxTouchPoints }: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean =>
  /Chrome\/|Firefox\//.test(userAgent) && !/Android|Mobile/.test(userAgent) && !(/Macintosh/.test(userAgent) && maxTouchPoints > 1)
