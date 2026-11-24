import type { Plugin } from 'vite-plus'

import { basename } from 'node:path'
import { brokerFrameScript } from '@fkn/lib/broker-frame'

/** Mounts fkn.app's broker frame from top-level html pages, at the start of `<body>`, so it loads while the bundle parses. Skips `embed.html`, which runs framed where `brokerFrameScript` is a no-op and would fail fkn.app's tenant `script-src 'self'` CSP. */
export const brokerFrame = (): Plugin => ({
  name: 'fkn-broker-frame',
  transformIndexHtml: (_html, ctx) => {
    const file = ctx?.filename ? basename(ctx.filename) : ctx?.path ? basename(ctx.path) : ''
    if (file === 'embed.html') return []
    return [{ tag: 'script', children: brokerFrameScript, injectTo: 'body-prepend' }]
  },
})
