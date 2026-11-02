import type { SourceCheck } from '../plugin-api'
import type { WindowSignIn } from './login-window'

import { signInThroughWindow } from './login-window'

/**
 * Opens an added source's check at `url` in an FKN window on stub's cloud jar, the one that source's frames read, and
 * closes the window once `passed` exists there. Call it directly in the click handler.
 */
export const passSourceCheck = ({ url, passed }: SourceCheck): Promise<WindowSignIn> =>
  signInThroughWindow({ url, domains: [new URL(url).hostname], cookies: 'persistent', isSignedIn: page => page.locator(passed).exists() })
