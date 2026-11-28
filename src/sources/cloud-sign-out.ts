import type { AttachFrameOptions, Frame } from '@fkn/lib'

import { signOutFromCloud } from '@banou/fkn-3p-auth'
import { attachFrame, isLocatorInvalid, isLocatorUnsupported, isPermissionDenied } from '@fkn/lib'

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
export const clearCloudCookies = (
  domains: string[],
  { attach = attachFrame, mount = () => mountHiddenFrame('Sign out') }: { attach?: Attach, mount?: () => { iframe: HTMLIFrameElement, remove: () => void } } = {},
): Promise<void> =>
  signOutFromCloud({
    client: { attachFrame: attach as typeof attachFrame, isLocatorInvalid, isLocatorUnsupported, isPermissionDenied },
    domains,
    mountHiddenFrame: () => mount(),
    throwOnError: true,
  })
