import { readPluginUris, writePluginUris } from './utils/plugin-links'
import { enabledPluginUris, onPluginsChange } from './plugins'
import { offerInvites, onInvitesChange, pendingInviteUris } from './plugin-invites'

// pending too: an offer has to stay on the url while its prompt is open, or a reload loses it
const desired = () => [...enabledPluginUris(), ...pendingInviteUris()]

const sync = () => {
  const next = writePluginUris(location.href, desired(), location.href)
  if (next !== location.href) history.replaceState(history.state, '', next)
}

const ingest = () => { void offerInvites(readPluginUris(location.href)) }

// wouter applies this to the rendered attribute only and navigates with the raw path, so it does not
// stack with the History patch below
export const pluginHref = (href: string): string => {
  const next = writePluginUris(href, desired(), location.href)
  return next.startsWith(location.origin) ? next.slice(location.origin.length) : next
}

// wouter navigates with `pushState(state, '', path)` and a path carries no query, so every <Link>
// would drop the plugins. Patching History catches every navigation, not just one router's.
const patch = (type: 'pushState' | 'replaceState') => {
  const original = history[type]
  history[type] = function (this: History, state: unknown, unused: string, url?: string | URL | null) {
    const target = url == null ? location.href : String(url)
    return original.call(this, state, unused, writePluginUris(target, desired(), location.href))
  }
}

const INSTALLED = Symbol.for('stub_plugin_url')

if (!(INSTALLED in globalThis)) {
  Object.defineProperty(globalThis, INSTALLED, { value: true })
  patch('pushState')
  patch('replaceState')
  addEventListener('popstate', () => { ingest(); sync() })
  onPluginsChange(sync)
  onInvitesChange(sync)
  ingest()
  sync()
}
