import type { RemoteVideoElement } from '@fkn/lib'
import type { ComponentChildren, FunctionComponent } from 'preact'
import type { PlayerCapabilities, PlayerChoice, PlayerSelection } from './types'

import {
  SubtitleCueOverlay,
  clampSubtitleBackgroundOpacity,
  clampSubtitleFontScale,
  clampSubtitleOffset,
  clampSubtitlePosition,
  isSubtitleFile,
  readDroppedSubtitleFiles,
  type ExternalSubtitleTrack,
  type SubtitlePosition,
} from '@banou/media-player'
import { parseSubtitleCues, type SubtitleCue } from '@banou/media-player/engine'
import { css } from '@emotion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { useHostEpisodeNavigation } from '../../embed-episode'
import { useHostSourceSwitch } from '../../embed-source-switch'
import { useHostSubtitleControls } from '../../embed-subtitles'
import {
  AlertDialog,
  BufferingIndicator,
  Container,
  Controls,
  ErrorDialog,
  FullscreenButton,
  MediaGesture,
  MediaHotkey,
  MuteButton,
  PiPButton,
  PlayButton,
  PlaybackRateButton,
  Popover,
  SeekButton,
  Slider,
  Time,
  TimeSlider,
  Tooltip,
  VolumeSlider,
} from '@videojs/react'
import {
  AudioTracksIcon,
  BackArrowIcon,
  CaptionsOffIcon,
  CaptionsOnIcon,
  CheckIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  NextIcon,
  PauseIcon,
  PipEnterIcon,
  PipExitIcon,
  PlayIcon,
  PreviousIcon,
  QualityIcon,
  RestartIcon,
  SearchIcon,
  SeekIcon,
  SourceSwitchIcon,
  SpinnerIcon,
  SubtitleOptionsIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeOffIcon,
} from './icons'

const SEEK_TIME = 10
const OPACITY_PRESETS = [0, 0.25, 0.5, 0.75, 1] as const

const asFC = <P,>(component: unknown): FunctionComponent<P> => component as FunctionComponent<P>

const ControlsRoot = asFC<{ className?: string, children?: ComponentChildren }>(Controls.Root)
const BufferingIndicatorC = asFC<{ render?: unknown }>(BufferingIndicator)
const ErrorDialogRoot = asFC<{ children?: ComponentChildren }>(ErrorDialog.Root)
const AlertDialogPopup = asFC<{ className?: string, children?: ComponentChildren }>(AlertDialog.Popup)
const AlertDialogTitle = asFC<{ className?: string, children?: ComponentChildren }>(AlertDialog.Title)
const AlertDialogClose = asFC<{ className?: string, children?: ComponentChildren }>(AlertDialog.Close)
const ErrorDialogDescription = asFC<{ className?: string }>(ErrorDialog.Description)
const TooltipProvider = asFC<{ children?: ComponentChildren }>(Tooltip.Provider)
const TooltipRoot = asFC<{ side?: string, children?: ComponentChildren }>(Tooltip.Root)
const TooltipTrigger = asFC<{ render?: ComponentChildren }>(Tooltip.Trigger)
const TooltipPopup = asFC<{ className?: string, children?: ComponentChildren }>(Tooltip.Popup)
const PopoverRoot = asFC<{
  open?: boolean
  onOpenChange?: (open: boolean) => void
  openOnHover?: boolean
  delay?: number
  closeDelay?: number
  side?: string
  children?: ComponentChildren
}>(Popover.Root)
const PopoverTrigger = asFC<{ render?: ComponentChildren, children?: ComponentChildren }>(Popover.Trigger)
const PopoverPopup = asFC<{ className?: string, children?: ComponentChildren }>(Popover.Popup)
const PlayButtonC = asFC<{ className?: string, render?: ComponentChildren, children?: ComponentChildren }>(PlayButton)
const SeekButtonC = asFC<{ seconds?: number, className?: string, render?: ComponentChildren, children?: ComponentChildren }>(SeekButton)
const MuteButtonC = asFC<{ className?: string, render?: ComponentChildren, children?: ComponentChildren }>(MuteButton)
const PiPButtonC = asFC<{ className?: string, render?: ComponentChildren, children?: ComponentChildren }>(PiPButton)
const FullscreenButtonC = asFC<{ className?: string, render?: ComponentChildren, children?: ComponentChildren }>(FullscreenButton)
const PlaybackRateButtonC = asFC<{ className?: string, render?: ComponentChildren }>(PlaybackRateButton)
const TimeValue = asFC<{ type?: string, className?: string }>(Time.Value)
const TimeSliderRoot = asFC<{ className?: string, children?: ComponentChildren }>(TimeSlider.Root)
const SliderTrack = asFC<{ className?: string, children?: ComponentChildren }>(Slider.Track)
const SliderFill = asFC<{ className?: string }>(Slider.Fill)
const SliderBuffer = asFC<{ className?: string }>(Slider.Buffer)
const SliderThumb = asFC<{ className?: string }>(Slider.Thumb)
const SliderValue = asFC<{ type?: string, className?: string }>(Slider.Value)
const VolumeSliderRoot = asFC<{ className?: string, orientation?: string, thumbAlignment?: string, children?: ComponentChildren }>(VolumeSlider.Root)
const MediaHotkeyC = asFC<{ keys: string, action: string, value?: number }>(MediaHotkey)
const MediaGestureC = asFC<{ type: string, action: string, value?: number, pointer?: string, region?: string }>(MediaGesture)
const ContainerC = asFC<{ ref?: (el: HTMLDivElement | null) => void, className?: string, children?: ComponentChildren } & Record<string, unknown>>(Container)
const EXT_SUBTITLE_PREFIX = 'ext:'
const EMPTY_SUBTITLE_CUES: readonly SubtitleCue[] = []

const dropOverlayStyle = css`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.45);

  > span {
    padding: 0.8rem 1.4rem;
    border-radius: 0.8rem;
    background: rgba(28, 28, 28, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.35);
    color: #fff;
    font-size: 1.3rem;
    font-weight: 500;
  }
`

type IntrinsicButton = {
  type?: 'button' | 'submit' | 'reset'
  className?: string
  'aria-label'?: string
  onClick?: () => void
  children?: ComponentChildren
}

const IconButton = ({ className, ...props }: IntrinsicButton) => (
  <button
    type="button"
    className={`media-button media-button--subtle media-button--icon${className ? ` ${className}` : ''}`}
    {...props}
  />
)

type SubtitleSettingsState = {
  offset: number
  onOffsetChange: (next: number) => void
  fontScale: number
  onFontScaleChange: (next: number) => void
  backgroundOpacity: number
  onBackgroundOpacityChange: (next: number) => void
  position: SubtitlePosition | null
  onResetPosition: () => void
}

const formatOffset = (offset: number) => {
  const abs = Math.abs(offset)
  const fixed = Math.round(abs * 100) % 10 === 0 ? abs.toFixed(1) : abs.toFixed(2)
  if (offset > 0) return `+${fixed}s`
  if (offset < 0) return `-${fixed}s`
  return '0.0s'
}

const formatStepOffset = (delta: number) => (delta > 0 ? `+${delta}s` : `${delta}s`)

const formatPercent = (value: number) => `${Math.round(value * 100)}%`

const STEP_MINUS = '-'
const STEP_PLUS = '+'
const stepButtonLabel = (label: string, symbol: string) => `${label} ${symbol}`

const SelectionMenu = ({ selection, icon, subtitleSettings, footerAction }: {
  selection: PlayerSelection
  icon: ComponentChildren
  subtitleSettings?: SubtitleSettingsState
  footerAction?: { label: string, onSelect: () => void }
}) => {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'tracks' | 'settings'>('tracks')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [selection.selectedId])
  useEffect(() => {
    if (!open) setView('tracks')
  }, [open])

  const choices = [
    ...(selection.offLabel ? [{ id: null as string | null, label: selection.offLabel }] : []),
    ...selection.options,
  ]

  const select = (id: string | null) => {
    if (id === selection.selectedId) {
      setOpen(false)
      return
    }
    setFailed(false)
    setPending(true)
    Promise.resolve()
      .then(() => selection.onSelect(id))
      .then(() => setOpen(false))
      .catch(err => {
        console.warn(`[player] ${selection.label} selection failed:`, err)
        setFailed(true)
      })
      .finally(() => setPending(false))
  }

  return (
    <PopoverRoot open={open} onOpenChange={next => setOpen(next)}>
      <PopoverTrigger
        render={
          <IconButton
            className={`media-button--menu${failed ? ' media-button--error' : ''}`}
            aria-label={selection.label}
          />
        }
      >
        {icon}
      </PopoverTrigger>
      <PopoverPopup className="media-surface media-popover media-popover--menu">
        {view === 'settings' && subtitleSettings ? (
          <div className="stub-menu stub-settings" role="dialog" aria-label={intl.formatMessage({ id: 'Subtitle settings', defaultMessage: 'Subtitle settings' })}>
            <div className="stub-menu__header">
              <button type="button" className="stub-menu__back" onClick={() => setView('tracks')}>
                <BackArrowIcon className="media-icon" />
                <span>{intl.formatMessage({ id: 'Subtitle settings', defaultMessage: 'Subtitle settings' })}</span>
              </button>
            </div>
            <div className="stub-settings__section">
              <div className="stub-settings__head">
                <span>{intl.formatMessage({ id: 'Timing offset', defaultMessage: 'Timing offset' })}</span>
                <span className="stub-settings__value">
                  <span className="offset-readout">{formatOffset(subtitleSettings.offset)}</span>
                  {subtitleSettings.offset !== 0 ? (
                    <button
                      type="button"
                      className="stub-reset-btn"
                      onClick={() => subtitleSettings.onOffsetChange(0)}
                    >
                      {intl.formatMessage({ id: 'Reset', defaultMessage: 'Reset' })}
                    </button>
                  ) : null}
                </span>
              </div>
              <div className="stub-settings__steps">
                {([-0.5, -0.1, 0.1, 0.5] as const).map(delta => (
                  <button
                    key={delta}
                    type="button"
                    className="stub-pill"
                    onClick={() => subtitleSettings.onOffsetChange(clampSubtitleOffset(subtitleSettings.offset + delta))}
                  >
                    {formatStepOffset(delta)}
                  </button>
                ))}
              </div>
            </div>
            <div className="stub-settings__section">
              <div className="stub-settings__head">
                <span>{intl.formatMessage({ id: 'Text size', defaultMessage: 'Text size' })}</span>
                <span className="stub-settings__scale">
                  <button
                    type="button"
                    className="stub-pill"
                    aria-label={stepButtonLabel(intl.formatMessage({ id: 'Text size', defaultMessage: 'Text size' }), STEP_MINUS)}
                    disabled={subtitleSettings.fontScale <= 0.5}
                    onClick={() => subtitleSettings.onFontScaleChange(clampSubtitleFontScale(subtitleSettings.fontScale - 0.1))}
                  >
                    {STEP_MINUS}
                  </button>
                  <span className="stub-settings__value">{formatPercent(subtitleSettings.fontScale)}</span>
                  <button
                    type="button"
                    className="stub-pill"
                    aria-label={stepButtonLabel(intl.formatMessage({ id: 'Text size', defaultMessage: 'Text size' }), STEP_PLUS)}
                    disabled={subtitleSettings.fontScale >= 2}
                    onClick={() => subtitleSettings.onFontScaleChange(clampSubtitleFontScale(subtitleSettings.fontScale + 0.1))}
                  >
                    {STEP_PLUS}
                  </button>
                </span>
              </div>
            </div>
            <div className="stub-settings__section">
              <div className="stub-settings__head">
                <span>{intl.formatMessage({ id: 'Background', defaultMessage: 'Background' })}</span>
                <span className="stub-settings__value">{formatPercent(subtitleSettings.backgroundOpacity)}</span>
              </div>
              <div className="stub-settings__bg">
                {OPACITY_PRESETS.map(preset => (
                  <button
                    key={preset}
                    type="button"
                    className="stub-pill"
                    aria-pressed={Math.abs(subtitleSettings.backgroundOpacity - preset) < 0.01}
                    onClick={() => subtitleSettings.onBackgroundOpacityChange(clampSubtitleBackgroundOpacity(preset))}
                  >
                    {formatPercent(preset)}
                  </button>
                ))}
              </div>
            </div>
            {subtitleSettings.position ? (
              <button type="button" className="stub-menu__item" onClick={subtitleSettings.onResetPosition}>
                <span className="stub-menu__label">{intl.formatMessage({ id: 'Reset position', defaultMessage: 'Reset position' })}</span>
              </button>
            ) : null}
          </div>
        ) : (
          <div className="stub-menu" role="menu" aria-label={selection.label}>
            {subtitleSettings ? (
              <div className="stub-menu__header">
                <div className="stub-menu__title">{selection.label}</div>
                <button
                  type="button"
                  className="stub-menu__action subtitle-options-btn"
                  aria-label={intl.formatMessage({ id: 'Subtitle settings', defaultMessage: 'Subtitle settings' })}
                  onClick={() => setView('settings')}
                >
                  <SubtitleOptionsIcon className="media-icon" />
                </button>
              </div>
            ) : (
              <div className="stub-menu__heading">{selection.label}</div>
            )}
            {choices.map(choice => {
              const selected = choice.id === selection.selectedId
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  key={choice.id ?? '__off__'}
                  className={`stub-menu__item${selected ? ' stub-menu__item--active' : ''}`}
                  disabled={pending || ('disabled' in choice && choice.disabled)}
                  onClick={() => select(choice.id)}
                >
                  <span className="stub-menu__check">{selected ? <CheckIcon className="media-icon" /> : null}</span>
                  <span className="stub-menu__label">{choice.label}</span>
                  {'kind' in choice && choice.kind ? (
                    <span className={`stub-menu__tag${choice.kind === 'external' ? ' stub-menu__tag--external' : ''}`}>
                      {choice.kind === 'external'
                        ? intl.formatMessage({ id: 'External', defaultMessage: 'External' })
                        : intl.formatMessage({ id: 'Native', defaultMessage: 'Native' })}
                    </span>
                  ) : null}
                  {'description' in choice && choice.description
                    ? <span className="stub-menu__description">{choice.description}</span>
                    : null}
                </button>
              )
            })}
            {footerAction ? (
              <button
                type="button"
                className="stub-menu__footer-action browse-subtitles"
                disabled={pending}
                onClick={() => {
                  if (pending) return
                  setOpen(false)
                  footerAction.onSelect()
                }}
              >
                <SearchIcon className="media-icon" />
                <span className="stub-menu__label">{footerAction.label}</span>
              </button>
            ) : null}
          </div>
        )}
      </PopoverPopup>
    </PopoverRoot>
  )
}

const VolumePopover = () => (
  <PopoverRoot openOnHover delay={200} closeDelay={100} side="top">
    <PopoverTrigger
      render={
        <MuteButtonC
          className="media-button--mute"
          render={<IconButton />}
        >
          <VolumeOffIcon className="media-icon media-icon--volume-off" />
          <VolumeLowIcon className="media-icon media-icon--volume-low" />
          <VolumeHighIcon className="media-icon media-icon--volume-high" />
        </MuteButtonC>
      }
    />
    <PopoverPopup className="media-surface media-popover media-popover--volume">
      <VolumeSliderRoot className="media-slider" orientation="vertical" thumbAlignment="edge">
        <SliderTrack className="media-slider__track">
          <SliderFill className="media-slider__fill" />
        </SliderTrack>
        <SliderThumb className="media-slider__thumb media-slider__thumb--persistent" />
      </VolumeSliderRoot>
    </PopoverPopup>
  </PopoverRoot>
)

export type VideoSurfaceProps = {
  capabilities?: PlayerCapabilities
  remote?: RemoteVideoElement | null
  children?: ComponentChildren
  className?: string
} & Record<string, unknown>

const VideoSurface = ({ capabilities, remote, children, className, ...rest }: VideoSurfaceProps) => {
  const intl = useIntl()
  const episodeNavigation = useHostEpisodeNavigation()
  const sourceSwitch = useHostSourceSwitch()
  const { tracks: hostExternalSubtitles, browseSubtitles, selection: hostSubtitleSelection } = useHostSubtitleControls()
  const nativeSubtitles = capabilities?.subtitles
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const [draggingSubtitle, setDraggingSubtitle] = useState(false)
  const dragDepthRef = useRef(0)
  const [droppedSubtitles, setDroppedSubtitles] = useState<ExternalSubtitleTrack[]>([])
  const [subtitleOffset, setSubtitleOffset] = useState(0)
  const [fontScale, setFontScale] = useState(1)
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.75)
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePosition | null>(null)
  const [activeExternalId, setActiveExternalId] = useState<string | null>(null)
  const [externalCues, setExternalCues] = useState<readonly SubtitleCue[]>(EMPTY_SUBTITLE_CUES)
  const cueCacheRef = useRef(new Map<string, readonly SubtitleCue[]>())
  const loadSeqRef = useRef(0)
  const prevNativeSelectedRef = useRef<string | null>(nativeSubtitles?.selectedId ?? null)
  const prevRemoteRef = useRef(remote)
  const pendingHostSelectRef = useRef<string | null>(null)
  const lastHostSelectSeqRef = useRef<number | undefined>(undefined)
  const flushingHostSelectRef = useRef(false)

  const allExternalSubtitles = useMemo(
    () => [...(hostExternalSubtitles ?? []), ...droppedSubtitles],
    [hostExternalSubtitles, droppedSubtitles],
  )

  useEffect(() => {
    if (prevRemoteRef.current === remote) return
    prevRemoteRef.current = remote
    pendingHostSelectRef.current = null
    setDroppedSubtitles([])
    setSubtitleOffset(0)
    setActiveExternalId(null)
    setExternalCues(EMPTY_SUBTITLE_CUES)
    cueCacheRef.current.clear()
    loadSeqRef.current++
  }, [remote])

  useEffect(() => {
    cueCacheRef.current.clear()
  }, [hostExternalSubtitles])

  useEffect(() => {
    if (!activeExternalId) return
    if (!allExternalSubtitles.some(track => track.id === activeExternalId)) {
      loadSeqRef.current++
      setActiveExternalId(null)
      setExternalCues(EMPTY_SUBTITLE_CUES)
    }
  }, [allExternalSubtitles, activeExternalId])

  useEffect(() => {
    const nextNative = nativeSubtitles?.selectedId ?? null
    const prevNative = prevNativeSelectedRef.current
    prevNativeSelectedRef.current = nextNative
    if (nextNative !== null && nextNative !== prevNative) {
      loadSeqRef.current++
      setActiveExternalId(null)
      setExternalCues(EMPTY_SUBTITLE_CUES)
    }
  }, [nativeSubtitles?.selectedId])

  const activateDroppedTrack = useCallback(async (track: ExternalSubtitleTrack) => {
    const cues = parseSubtitleCues(track.content ?? '', track.format)
    cueCacheRef.current.set(track.id, cues)
    const seq = ++loadSeqRef.current
    if (nativeSubtitles && nativeSubtitles.selectedId !== null) {
      await Promise.resolve(nativeSubtitles.onSelect(null)).catch(() => {})
    }
    if (seq !== loadSeqRef.current) return
    setActiveExternalId(track.id)
    setExternalCues(cues)
  }, [nativeSubtitles])

  const activateDroppedRef = useRef(activateDroppedTrack)
  activateDroppedRef.current = activateDroppedTrack

  useEffect(() => {
    if (!containerEl) return
    const currentRemote = remote
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types?.includes('Files')) return
      dragDepthRef.current++
      setDraggingSubtitle(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types?.includes('Files')) return
      event.preventDefault()
    }
    const onDragLeave = (event: DragEvent) => {
      if (!event.dataTransfer?.types?.includes('Files')) return
      if (--dragDepthRef.current <= 0) {
        dragDepthRef.current = 0
        setDraggingSubtitle(false)
      }
    }
    const onDrop = (event: DragEvent) => {
      dragDepthRef.current = 0
      setDraggingSubtitle(false)
      const files = Array.from(event.dataTransfer?.files ?? []).filter(isSubtitleFile)
      if (!files.length) return
      event.preventDefault()
      event.stopPropagation()
      void readDroppedSubtitleFiles(files).then((added) => {
        if (!added.length || prevRemoteRef.current !== currentRemote) return
        setDroppedSubtitles(prev => [...prev, ...added])
        return activateDroppedRef.current(added[0]!)
      })
    }
    const endDrag = () => { dragDepthRef.current = 0; setDraggingSubtitle(false) }
    containerEl.addEventListener('dragenter', onDragEnter)
    containerEl.addEventListener('dragover', onDragOver)
    containerEl.addEventListener('dragleave', onDragLeave)
    containerEl.addEventListener('drop', onDrop)
    window.addEventListener('dragend', endDrag)
    return () => {
      containerEl.removeEventListener('dragenter', onDragEnter)
      containerEl.removeEventListener('dragover', onDragOver)
      containerEl.removeEventListener('dragleave', onDragLeave)
      containerEl.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', endDrag)
    }
  }, [containerEl, remote])

  const hasBrowseSubtitles = Boolean(browseSubtitles)
  const subtitleSelection = useMemo<PlayerSelection | undefined>(() => {
    if (!nativeSubtitles && !allExternalSubtitles.length && !hasBrowseSubtitles) return undefined

    const options: PlayerChoice[] = [
      ...(nativeSubtitles?.options.map(option => ({ ...option, kind: option.kind ?? ('native' as const) })) ?? []),
      ...allExternalSubtitles.map(track => ({
        id: `${EXT_SUBTITLE_PREFIX}${track.id}`,
        label: track.label,
        kind: 'external' as const,
      })),
    ]
    const activeExternal = activeExternalId && allExternalSubtitles.some(track => track.id === activeExternalId)
      ? `${EXT_SUBTITLE_PREFIX}${activeExternalId}`
      : null

    return {
      label: nativeSubtitles?.label ?? intl.formatMessage({ id: 'Subtitles', defaultMessage: 'Subtitles' }),
      ...(options.length > 0
        ? { offLabel: nativeSubtitles?.offLabel ?? intl.formatMessage({ id: 'Off#subtitles turned off', defaultMessage: 'Off', description: 'subtitles turned off' }) }
        : {}),
      selectedId: activeExternal ?? nativeSubtitles?.selectedId ?? null,
      options,
      onSelect: async (id) => {
        if (!flushingHostSelectRef.current) pendingHostSelectRef.current = null
        if (id !== null && id.startsWith(EXT_SUBTITLE_PREFIX)) {
          const trackId = id.slice(EXT_SUBTITLE_PREFIX.length)
          const track = allExternalSubtitles.find((entry: ExternalSubtitleTrack) => entry.id === trackId)
          if (!track) throw new Error('External subtitle track unavailable')
          const seq = ++loadSeqRef.current
          let cues = cueCacheRef.current.get(track.id)
          if (!cues) {
            const content = 'content' in track && typeof track.content === 'string' ? track.content : undefined
            const url = 'url' in track && typeof track.url === 'string' ? track.url : undefined
            const load = 'load' in track && typeof track.load === 'function' ? track.load : undefined
            const text = content !== undefined
              ? content
              : load
                ? await load()
                : url
                  ? await fetch(url).then(res => {
                      if (!res.ok) throw new Error(`HTTP ${res.status}`)
                      return res.text()
                    })
                  : await Promise.reject(new Error('External subtitle source unavailable'))
            cues = parseSubtitleCues(text, track.format)
            cueCacheRef.current.set(track.id, cues)
          }
          if (seq !== loadSeqRef.current) return
          if (nativeSubtitles && nativeSubtitles.selectedId !== null) {
            await nativeSubtitles.onSelect(null)
          }
          if (seq !== loadSeqRef.current) return
          setActiveExternalId(track.id)
          setExternalCues(cues)
          return
        }

        loadSeqRef.current++
        if (nativeSubtitles && (id !== null || nativeSubtitles.selectedId !== null)) {
          await nativeSubtitles.onSelect(id)
        }
        setActiveExternalId(null)
        setExternalCues(EMPTY_SUBTITLE_CUES)
      },
    }
  }, [nativeSubtitles, allExternalSubtitles, activeExternalId, hasBrowseSubtitles, intl])

  const hostSelectId = hostSubtitleSelection?.id
  const hostSelectSeq = hostSubtitleSelection?.seq
  useEffect(() => {
    if (hostSelectId === undefined || hostSelectSeq === undefined) return
    if (lastHostSelectSeqRef.current === hostSelectSeq) return
    lastHostSelectSeqRef.current = hostSelectSeq
    pendingHostSelectRef.current = hostSelectId
  }, [hostSelectId, hostSelectSeq])

  useEffect(() => {
    const pendingId = pendingHostSelectRef.current
    if (!pendingId || !subtitleSelection) return
    if (!allExternalSubtitles.some(track => track.id === pendingId)) return
    pendingHostSelectRef.current = null
    flushingHostSelectRef.current = true
    try {
      void Promise.resolve(subtitleSelection.onSelect(`${EXT_SUBTITLE_PREFIX}${pendingId}`)).catch(err => {
        console.warn('[player] external subtitle selection failed:', err)
      })
    } finally {
      flushingHostSelectRef.current = false
    }
  }, [hostSelectId, hostSelectSeq, allExternalSubtitles, subtitleSelection])

  const subtitleSettings = useMemo<SubtitleSettingsState>(() => ({
    offset: subtitleOffset,
    onOffsetChange: setSubtitleOffset,
    fontScale,
    onFontScaleChange: setFontScale,
    backgroundOpacity,
    onBackgroundOpacityChange: setBackgroundOpacity,
    position: subtitlePosition,
    onResetPosition: () => setSubtitlePosition(null),
  }), [subtitleOffset, fontScale, backgroundOpacity, subtitlePosition])

  const previousLabel = episodeNavigation?.previous
    ? episodeNavigation.previous.title?.trim() || intl.formatMessage({ id: 'Previous episode', defaultMessage: 'Previous episode' })
    : undefined
  const nextLabel = episodeNavigation?.next
    ? episodeNavigation.next.title?.trim() || intl.formatMessage({ id: 'Next episode', defaultMessage: 'Next episode' })
    : undefined
  const sourceSwitchLabel = sourceSwitch
    ? sourceSwitch.title?.trim() || intl.formatMessage({ id: 'Switch source', defaultMessage: 'Switch source' })
    : undefined
  return (
    <ContainerC ref={setContainerEl} className={`media-default-skin media-default-skin--video${className ? ` ${className}` : ''}`} {...rest}>
      {children}
      {externalCues.length ? (
        <SubtitleCueOverlay
          cues={externalCues}
          media={remote ?? null}
          offset={subtitleOffset}
          fontScale={fontScale}
          backgroundOpacity={backgroundOpacity}
          position={subtitlePosition}
          onPositionChange={setSubtitlePosition}
        />
      ) : null}
      {draggingSubtitle ? (
        <div css={dropOverlayStyle}>
          <span>{intl.formatMessage({ id: 'Drop subtitle file to load', defaultMessage: 'Drop subtitle file to load' })}</span>
        </div>
      ) : null}
      <BufferingIndicatorC
        render={(props: Record<string, unknown>) => (
          <div {...props} className="media-buffering-indicator">
            <div className="media-surface">
              <SpinnerIcon className="media-icon" />
            </div>
          </div>
        )}
      />
      <ErrorDialogRoot>
        <AlertDialogPopup className="media-error">
          <div className="media-error__dialog media-surface">
            <div className="media-error__content">
              <AlertDialogTitle className="media-error__title">{intl.formatMessage({ id: 'Something went wrong.', defaultMessage: 'Something went wrong.' })}</AlertDialogTitle>
              <ErrorDialogDescription className="media-error__description" />
            </div>
            <div className="media-error__actions">
              <AlertDialogClose className="media-button media-button--primary">{intl.formatMessage({ id: 'OK', defaultMessage: 'OK' })}</AlertDialogClose>
            </div>
          </div>
        </AlertDialogPopup>
      </ErrorDialogRoot>
      <ControlsRoot className="media-surface media-controls">
        <TooltipProvider>
          <div className="media-button-group">
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <PlayButtonC className="media-button--play" render={<IconButton />}>
                    <RestartIcon className="media-icon media-icon--restart" />
                    <PlayIcon className="media-icon media-icon--play" />
                    <PauseIcon className="media-icon media-icon--pause" />
                  </PlayButtonC>
                }
              />
              <TooltipPopup className="media-surface media-tooltip" />
            </TooltipRoot>
            {episodeNavigation?.previous && previousLabel ? (
              <TooltipRoot side="top">
                <TooltipTrigger
                  render={
                    <IconButton
                      className="media-button--previous"
                      aria-label={previousLabel}
                      onClick={() => episodeNavigation.previous?.request()}
                    >
                      <PreviousIcon className="media-icon" />
                    </IconButton>
                  }
                />
                <TooltipPopup className="media-surface media-tooltip">{previousLabel}</TooltipPopup>
              </TooltipRoot>
            ) : null}
            {episodeNavigation?.next && nextLabel ? (
              <TooltipRoot side="top">
                <TooltipTrigger
                  render={
                    <IconButton
                      className="media-button--next"
                      aria-label={nextLabel}
                      onClick={() => episodeNavigation.next?.request()}
                    >
                      <NextIcon className="media-icon" />
                    </IconButton>
                  }
                />
                <TooltipPopup className="media-surface media-tooltip">{nextLabel}</TooltipPopup>
              </TooltipRoot>
            ) : null}
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <SeekButtonC seconds={-SEEK_TIME} className="media-button--seek" render={<IconButton />}>
                    <span className="media-icon__container">
                      <SeekIcon className="media-icon media-icon--seek media-icon--flipped" />
                      <span className="media-icon__label">{SEEK_TIME}</span>
                    </span>
                  </SeekButtonC>
                }
              />
              <TooltipPopup className="media-surface media-tooltip">{intl.formatMessage({ id: '{seconds, plural, one {Seek backward {seconds} second} other {Seek backward {seconds} seconds}}', defaultMessage: '{seconds, plural, one {Seek backward {seconds} second} other {Seek backward {seconds} seconds}}' }, { seconds: SEEK_TIME })}</TooltipPopup>
            </TooltipRoot>
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <SeekButtonC seconds={SEEK_TIME} className="media-button--seek" render={<IconButton />}>
                    <span className="media-icon__container">
                      <SeekIcon className="media-icon media-icon--seek" />
                      <span className="media-icon__label">{SEEK_TIME}</span>
                    </span>
                  </SeekButtonC>
                }
              />
              <TooltipPopup className="media-surface media-tooltip">{intl.formatMessage({ id: '{seconds, plural, one {Seek forward {seconds} second} other {Seek forward {seconds} seconds}}', defaultMessage: '{seconds, plural, one {Seek forward {seconds} second} other {Seek forward {seconds} seconds}}' }, { seconds: SEEK_TIME })}</TooltipPopup>
            </TooltipRoot>
          </div>
          <div className="media-time-controls">
            <TimeValue type="current" className="media-time" />
            <TimeSliderRoot className="media-slider">
              <SliderTrack className="media-slider__track">
                <SliderFill className="media-slider__fill" />
                <SliderBuffer className="media-slider__buffer" />
              </SliderTrack>
              <SliderThumb className="media-slider__thumb" />
              {/* media-thumbnail, not media-preview: videojs beta.26 renamed the block, and the old
                  name matches nothing, which costs the readout its positioning and its backdrop */}
              <div className="media-surface media-thumbnail media-slider__preview">
                <SliderValue type="pointer" className="media-time media-thumbnail__time" />
              </div>
            </TimeSliderRoot>
            <TimeValue type="duration" className="media-time" />
          </div>
          <div className="media-button-group">
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <PlaybackRateButtonC className="media-button--playback-rate" render={<IconButton />} />
                }
              />
              <TooltipPopup className="media-surface media-tooltip">{intl.formatMessage({ id: 'Toggle playback rate', defaultMessage: 'Toggle playback rate' })}</TooltipPopup>
            </TooltipRoot>
            <VolumePopover />
            {sourceSwitch && sourceSwitchLabel ? (
              <TooltipRoot side="top">
                <TooltipTrigger
                  render={
                    <IconButton
                      className="media-button--source-switch"
                      aria-label={sourceSwitchLabel}
                      onClick={sourceSwitch.request}
                    >
                      <SourceSwitchIcon className="media-icon" />
                    </IconButton>
                  }
                />
                <TooltipPopup className="media-surface media-tooltip">{sourceSwitchLabel}</TooltipPopup>
              </TooltipRoot>
            ) : null}
            {subtitleSelection && (
              <SelectionMenu
                key="subtitles"
                selection={subtitleSelection}
                subtitleSettings={subtitleSelection.options.length > 0 ? subtitleSettings : undefined}
                footerAction={browseSubtitles
                  ? {
                    label: browseSubtitles.title?.trim() || intl.formatMessage({ id: 'Look for more', defaultMessage: 'Look for more' }),
                    onSelect: browseSubtitles.request,
                  }
                  : undefined}
                icon={subtitleSelection.selectedId
                  ? <CaptionsOnIcon className="media-icon" />
                  : <CaptionsOffIcon className="media-icon" />}
              />
            )}
            {capabilities?.audioTracks && (
              <SelectionMenu key="audio" selection={capabilities.audioTracks} icon={<AudioTracksIcon className="media-icon" />} />
            )}
            {capabilities?.qualityLevels && (
              <SelectionMenu key="quality" selection={capabilities.qualityLevels} icon={<QualityIcon className="media-icon" />} />
            )}
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <PiPButtonC className="media-button--pip" render={<IconButton />}>
                    <PipEnterIcon className="media-icon media-icon--pip-enter" />
                    <PipExitIcon className="media-icon media-icon--pip-exit" />
                  </PiPButtonC>
                }
              />
              <TooltipPopup className="media-surface media-tooltip" />
            </TooltipRoot>
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <FullscreenButtonC className="media-button--fullscreen" render={<IconButton />}>
                    <FullscreenEnterIcon className="media-icon media-icon--fullscreen-enter" />
                    <FullscreenExitIcon className="media-icon media-icon--fullscreen-exit" />
                  </FullscreenButtonC>
                }
              />
              <TooltipPopup className="media-surface media-tooltip" />
            </TooltipRoot>
          </div>
        </TooltipProvider>
      </ControlsRoot>
      <div className="media-overlay" />
      <MediaHotkeyC keys="Space" action="togglePaused" />
      <MediaHotkeyC keys="k" action="togglePaused" />
      <MediaHotkeyC keys="m" action="toggleMuted" />
      <MediaHotkeyC keys="f" action="toggleFullscreen" />
      <MediaHotkeyC keys="i" action="togglePictureInPicture" />
      <MediaHotkeyC keys="ArrowRight" action="seekStep" value={5} />
      <MediaHotkeyC keys="ArrowLeft" action="seekStep" value={-5} />
      <MediaHotkeyC keys="l" action="seekStep" value={10} />
      <MediaHotkeyC keys="j" action="seekStep" value={-10} />
      <MediaHotkeyC keys="ArrowUp" action="volumeStep" value={0.05} />
      <MediaHotkeyC keys="ArrowDown" action="volumeStep" value={-0.05} />
      <MediaHotkeyC keys="0-9" action="seekToPercent" />
      <MediaHotkeyC keys="Home" action="seekToPercent" value={0} />
      <MediaHotkeyC keys="End" action="seekToPercent" value={100} />
      <MediaGestureC type="tap" action="togglePaused" pointer="mouse" region="center" />
      <MediaGestureC type="tap" action="toggleControls" pointer="touch" />
      <MediaGestureC type="doubletap" action="seekStep" value={-10} region="left" />
      <MediaGestureC type="doubletap" action="toggleFullscreen" region="center" />
      <MediaGestureC type="doubletap" action="seekStep" value={10} region="right" />
    </ContainerC>
  )
}

export default VideoSurface as FunctionComponent<VideoSurfaceProps>
