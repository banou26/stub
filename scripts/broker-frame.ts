import type { Plugin } from 'vite-plus'

import { brokerFrameScript } from '@fkn/lib/broker-frame'

/** Mounts fkn.app's broker frame from every page's html, at the start of `<body>`, so it loads while the bundle parses. `@fkn/lib` adopts it, and it mounts nothing inside fkn.app. */
export const brokerFrame = (): Plugin => ({
  name: 'fkn-broker-frame',
  transformIndexHtml: () => [{ tag: 'script', children: brokerFrameScript, injectTo: 'body-prepend' }],
})
