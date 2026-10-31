import type { RefObject } from 'preact'

import type { MountedPackage } from '@fkn/lib/packages'

import { css } from '@emotion/react'
import { packages } from '@fkn/lib'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import type { PlaybackLink } from '../party/bridge'

import { STUB_SOURCE_PROTOCOL, type PluginSettings, type ViewerLanguages } from '../plugin-api'
import { pluginPlaybackLink, servePluginFullscreen, type PlaybackSource } from '../party/plugin-link'
import { loadPluginValues } from '../plugin-list'
import { fromUri } from '../utils/uri'
import { viewerLanguages } from '../viewer-languages'
import { handValues } from '../worker/plugin-sources'

const style = css`
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  background: #000;

  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: none;
  }

  .failed {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    text-align: center;
    background: #000;
    color: rgba(255, 255, 255, 0.55);
    font-size: 1.4rem;
  }
`

type PlayableSource = PlaybackSource & {
  origin?: string
  play?: (release: { uri: string, url?: string, languages?: ViewerLanguages }) => Promise<boolean>
}

type PluginPayload = PlayableSource & Pick<PluginSettings, 'configure'> & { sources?: PlayableSource[] }

export type PluginPlayerProps = {
  /** the package, the same for the component's life: the page keys it on this */
  pluginUri: string
  /** the handle stub already holds for this release; the source reads whatever it put there */
  release: { uri: string, url?: string }
  onUnplayable: () => void
  /** the player's link once it is up, and undefined again when it goes; only for a source that serves one */
  onPlayback?: (link: PlaybackLink | undefined) => void
  /** what goes fullscreen when the player asks, for a source that hands its player's fullscreen over */
  stage?: RefObject<HTMLElement | null>
}

/**
 * Plays a release inside the source package's own frame.
 *
 * `mount` rather than `show`: the frame is ours, so it lays out in the player box, scrolls with the page
 * and fullscreens natively. `show` would paint it in FKN's overlay at the top of the stacking order,
 * which is fine for a modal picker and wrong for a player sitting in a page that has its own chrome
 * over it.
 *
 * The connection is this component's own, separate from the worker's: they are two documents of one
 * package, so calling `play` on the worker's connection would render into a frame nobody can see.
 *
 * The package's document is mounted for the first release and kept for the next ones, each played in
 * it in turn: WebKit lets a cross-origin frame move the keys only once the viewer has clicked in it or
 * in a frame inside it (WebKit 26.4 and 27.2, 2026-10-26), so a package mounted afresh for each episode
 * could never hand them on to the next one's player. A mount that failed is tried again for the next.
 */
export const PluginPlayer = ({ pluginUri, release, onUnplayable, onPlayback, stage }: PluginPlayerProps) => {
  const intl = useIntl()
  const slot = useRef<HTMLIFrameElement>(null)
  const [failed, setFailed] = useState(false)
  // read at call time: the effect below is keyed on the release, and the page hands in new closures on every render
  const callbacks = useRef({ onUnplayable, onPlayback })
  callbacks.current = { onUnplayable, onPlayback }
  const mounted = useRef<Promise<MountedPackage<PluginPayload>>>(undefined)

  useEffect(() => {
    const iframe = slot.current
    if (!iframe) return
    let done = false
    let link: PlaybackLink | undefined
    let stopFullscreen: (() => void) | undefined
    setFailed(false)

    const run = async () => {
      try {
        // the SAME contract tag the worker connects under. Both are stub asking for `stub-source@1`, and
        // this is the hop that renders the package into stub's own document, so it is the last one that
        // should arrive unnamed: a package reading `protocol` to decide what it serves would otherwise
        // see null here and have to guess.
        mounted.current ??= packages.mount<PluginPayload>(pluginUri, { iframe, protocol: STUB_SOURCE_PROTOCOL })
          .catch(error => { mounted.current = undefined; throw error })
        const connection = await mounted.current
        if (done) return
        // one package may ship a family of sources, so the one that owns this release is picked by the
        // origin its uri carries. The single-source shape is the same payload without the list, which
        // is what every plugin written before source families sends.
        const { origin } = fromUri(release.uri as `${string}:${string}`)
        const payload = connection.remote
        // this document is not the one the worker's connection configured
        if (payload.configure) await handValues(payload.configure, loadPluginValues(pluginUri))
        if (done) return
        const source = payload.sources?.find(entry => entry.origin === origin) ?? payload
        const played = await source.play?.({ uri: release.uri, url: release.url, languages: viewerLanguages() })
        if (done) return
        // false is the source saying it cannot play THIS release, which is a fallback, not a failure
        if (!played) { callbacks.current.onUnplayable(); return }
        link = pluginPlaybackLink(source, iframe)
        if (link) callbacks.current.onPlayback?.(link)
        if (stage?.current) stopFullscreen = servePluginFullscreen(source, stage.current)
      } catch (error) {
        if (done) return
        console.warn(`Source '${pluginUri}' could not start playback:`, error)
        setFailed(true)
      }
    }
    void run()

    return () => {
      done = true
      stopFullscreen?.()
      if (link) { link.dispose(); callbacks.current.onPlayback?.(undefined) }
    }
  }, [pluginUri, release.uri, release.url])
  useEffect(() => () => { void mounted.current?.then(connection => connection.unmount(), () => {}) }, [])

  return (
    <div css={style}>
      {/*
        Rendered unconditionally, and the failure message covers it rather than replacing it. The effect
        needs this ref to exist to mount at all, so swapping the frame out on failure would mean a source
        that failed once could never be retried, not even for a different release.

        The capabilities are granted HERE because permissions policy is read at navigation and is not
        inherited. The plugin passes the same set down to whatever it nests inside itself (ripple, for a
        torrent release), and it can only pass on what this frame was granted.

        SANDBOX FLAGS ARE THE SAME STORY and go one worse: a nested frame INHERITS this set and can only
        add to it, so a player two frames down cannot ask for anything back.

        Measured 2026-09-09 on Chrome 149, driving this frame chain against the live torrent.fkn.app
        and clicking ripple's own "Open this torrent in Ripple", one run per flag set:

          allow-scripts allow-same-origin            NOTHING HAPPENS. "Blocked opening
                                                     'https://torrent.fkn.app/?torrent=...' in a new
                                                     window because the request was made in a
                                                     sandboxed frame whose 'allow-popups' permission
                                                     is not set", in the console and nowhere else.
          + allow-popups                             the tab opens, still sandboxed: measured over the
                                                     same chain, a download is refused and a form
                                                     submit does nothing.
          + allow-popups-to-escape-sandbox           the tab opens as an ordinary page, and both work.

        So both flags are load bearing, because the player offers exactly those two links: one opens a
        page that navigates, the other saves a file.
      */}
      <iframe
        ref={slot}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        allow="fullscreen; autoplay; encrypted-media; cross-origin-isolated"
      />
      {failed ? <div className="failed">{intl.formatMessage({ id: 'This source could not start playback.', defaultMessage: 'This source could not start playback.' })}</div> : null}
    </div>
  )
}

export default PluginPlayer
