// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

const plugins = vi.hoisted(() => ({ statuses: [] as object[], listeners: new Set<() => void>() }))
vi.mock('../../../src/plugins', () => ({
  pluginStatuses: () => plugins.statuses,
  onPluginsChange: (listener: () => void) => {
    plugins.listeners.add(listener)
    return () => { plugins.listeners.delete(listener) }
  },
}))

const { usePluginStatuses } = await import('../../../src/utils/use-plugin-statuses')

const States = () => <p>{usePluginStatuses().map(status => (status as { state: string }).state).join()}</p>

test('a package that connects between the first render and the subscription is heard', () => {
  plugins.statuses = [{ uri: 'npm:source', state: 'connecting' }]
  let host!: HTMLElement
  act(() => {
    host = mount(<States/>)
    plugins.statuses = [{ uri: 'npm:source', state: 'connected' }]
    for (const listener of plugins.listeners) listener()
  })
  expect(host.textContent).toBe('connected')
  unmount(host)
})
