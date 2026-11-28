type Listener = ((event: { data: unknown }) => void) | null

/**
 * BroadcastChannel as a browser runs it, for the documents of one test: what a channel posts, the same
 * message again included, reaches every other channel of its name, and never the channel that posted it.
 * It arrives at once, so ahead of a storage event a test hands over after it, the order Chrome 155
 * delivered them in.
 */
export const fakeBroadcastChannel = () => {
  const channels = new Set<{
    name: string
    onmessage: Listener
    listeners: Set<(event: { data: unknown }) => void>
  }>()
  return class {
    onmessage: Listener = null
    listeners = new Set<(event: { data: unknown }) => void>()
    constructor(readonly name: string) { channels.add(this) }
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      if (type === 'message') this.listeners.add(listener)
    }
    removeEventListener(type: string, listener: (event: { data: unknown }) => void) {
      if (type === 'message') this.listeners.delete(listener)
    }
    close() { channels.delete(this) }
    postMessage(data: unknown) {
      for (const other of channels) {
        if (other !== this && other.name === this.name) {
          other.onmessage?.({ data })
          for (const listener of other.listeners) listener({ data })
        }
      }
    }
  }
}
