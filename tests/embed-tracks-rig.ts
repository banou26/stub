import type { EmbedTracks } from '../src/embed-tracks'

import { embedTracks, serveEmbedTracks } from '../src/embed-tracks'

// Both ends of the tracks channel for ./embed-tracks.spec.ts: the page frames /embed.html on its own origin, and the
// same module runs in each. The embed changes its tracks right after its first send, so the page reads the change
// only in the embed's answer to the ask the page sends on the frame's `load`.

export type Rig = { heard: EmbedTracks[], picks: string[], pick: () => void }

const rig = window as unknown as Rig

if (window === window.parent) {
  const iframe = document.createElement('iframe')
  const link = embedTracks(iframe)
  rig.heard = []
  link.onTracks(tracks => rig.heard.push(tracks))
  // from a task of the browser's own, as a control's handler runs
  rig.pick = () => setTimeout(() => link.select('audio', 'English'))
  iframe.src = '/embed.html'
  document.body.append(iframe)
} else {
  const tracks: EmbedTracks = { audio: { ids: ['Japanese', 'English'], selected: 'Japanese' }, busy: true }
  rig.picks = []
  serveEmbedTracks(tracks, (kind, id) => rig.picks.push(`${kind} ${id}`))
  tracks.busy = false
}
