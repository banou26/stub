import { readPluginUris, writePluginUris } from './utils/plugin-links'
import { loadEnabled } from './plugin-list'
import { enabledPluginUris, onPluginsChange } from './plugins'
import { addInvites, onInvitesChange, pendingInviteUris } from './plugin-invites'

// pending too: a link's source has to stay on the url until FKN answers, or a reload loses it
const desired = () => [...enabledPluginUris(), ...pendingInviteUris()]

const sync = () => {
  const next = writePluginUris(location.href, desired(), location.href)
  if (next !== location.href) history.replaceState(history.state, '', next)
}

// wouter applies this to the rendered attribute only and navigates with the raw path, so it does not
// stack with the History patch below. That attribute is what a link opened in another tab carries, so it
// names only what a list stub keeps: not a source FKN holds for this tab alone, which that tab would keep,
// nor one still waiting on FKN, which may turn out to be one.
export const pluginHref = (href: string): string => {
  const next = writePluginUris(href, loadEnabled(), location.href)
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
  // a link is read once, as the page loads: an entry Back or Forward reaches is stub's own mirror of the list
  // as it was then, and a source removed since must not come back through it
  addEventListener('popstate', sync)
  onPluginsChange(sync)
  onInvitesChange(sync)
  void addInvites(readPluginUris(location.href))
  sync()
}
