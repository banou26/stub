import { expose } from 'osra'

import { PLUGIN_ORIGIN } from './watch-stage-media'

// What tests/watch-stage.spec.ts builds src/components/plugin-player.tsx with in place of @fkn/lib, which mounts a
// package through FKN: here the package is ./watch-stage-plugin.ts at its own origin, in the frame the player hands
// over, connected over a port it is handed once it has loaded.

export const packages = {
  mount: async (_uri: string, { iframe }: { iframe: HTMLIFrameElement }) => {
    const loaded = new Promise(resolve => iframe.addEventListener('load', resolve, { once: true }))
    iframe.src = `${PLUGIN_ORIGIN}/plugin.html`
    await loaded
    const { port1, port2 } = new MessageChannel()
    iframe.contentWindow!.postMessage('stage-plugin', PLUGIN_ORIGIN, [port2])
    const remote = await expose({}, { transport: port1 })
    return { remote, frame: iframe, unmount: () => port1.close() }
  },
}
