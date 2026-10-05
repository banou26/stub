import type { AttachFrameOptions, Frame } from '@fkn/lib'

import { attachFrame } from '@fkn/lib'

import { mountHiddenFrame } from '../utils/hidden-frame'

type Attach = (options: Pick<AttachFrameOptions, 'iframe' | 'domains' | 'cookies'>) => Promise<Pick<Frame, 'clearCookies'>>

/**
 * Signs out of the sites `domains` names on the cloud: removes every cookie of theirs from the app's kept
 * cloud jar. A session signed in through an FKN window lives in that jar and nowhere in stub, so this is
 * the only way out of it. The jar is the top-level site's, so every fkn.app app is signed out with stub.
 * The site is not told, and its session stays valid there until it lapses, held by nobody.
 *
 * Cloud only: with the extension a session is the browser's own, which FKN does not clear. Rejects with
 * FKN's own error when the removal was refused or not confirmed; calling it again is safe.
 */
export const clearCloudCookies = async (
  domains: string[],
  { attach = attachFrame, mount = () => mountHiddenFrame('Sign out') }: { attach?: Attach, mount?: () => { iframe: HTMLIFrameElement, remove: () => void } } = {},
): Promise<void> => {
  const { iframe, remove } = mount()
  try {
    const frame = await attach({ iframe, domains, cookies: 'persistent' })
    await frame.clearCookies()
  } finally {
    remove()
  }
}
