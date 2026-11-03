import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { languageTag } from '@banou/media-player/language'
import { useEffect, useId, useMemo, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { switchStyle } from '../../components/switch-style'
import { contentLanguage, OFFERED } from '../../i18n/languages'
import { settings } from '../../settings-store'
import { readAutoplay, setAutoplay, watchAutoplay } from '../../utils/autoplay'
import {
  AUDIO_LANGUAGE_KEY, keepAlwaysSubtitles, keepAudioLanguage, keepSubtitleLanguage, OFF, ORIGINAL, readTrackLanguages,
  SUBTITLE_LANGUAGE_KEY, watchTrackLanguages,
} from '../../utils/track-languages'
import { languageName } from './language'

const style = css`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 52rem;

  label.switch {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    padding: 1.4rem 1.6rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.02);
    font-size: 1.5rem;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
    transition: border-color 0.15s;

    &:hover { border-color: rgba(255, 255, 255, 0.25); }
  }
`

const Switch = ({ children, on, set }: { children: ComponentChildren, on: boolean, set: (on: boolean) => void }) => (
  <label className="switch">
    {children}
    <input
      type="checkbox"
      role="switch"
      css={switchStyle}
      checked={on}
      onChange={event => set((event.target as HTMLInputElement).checked)}
    />
  </label>
)

/**
 * A language setting: Automatic, naming the viewer's language, then `first`, then each offered language by name, and
 * a language a player reported that none of them is, by its name or as reported.
 */
const LanguageRow = ({ title, setting, value, first, pick }: {
  title: string
  setting: string
  value: string | null
  first: { value: string, label: string }
  pick: (value: string | undefined) => void
}) => {
  const intl = useIntl()
  const id = useId()
  const nameOf = (tag: string) => languageName(tag, intl.locale)
  const byName = useMemo(() => {
    const { compare } = new Intl.Collator(intl.locale)
    return OFFERED.map(tag => ({ value: tag, label: nameOf(tag) })).sort((a, b) => compare(a.label, b.label))
  }, [intl])
  const listed = (option: string) => option === first.value || OFFERED.includes(option)
  const tag = languageTag(value ?? undefined)
  const shown = value === null ? '' : listed(value) ? value : tag && OFFERED.includes(tag) ? tag : value
  const reported = shown === '' || listed(shown) ? [] : [{ value: shown, label: tag ? nameOf(tag) : shown }]
  return (
    <div className="row" data-setting={setting}>
      <div className="head">
        <h3 id={id}>{title}</h3>
      </div>
      <select aria-labelledby={id} value={shown} onChange={event => pick(event.currentTarget.value || undefined)}>
        <option value="">{intl.formatMessage({ id: 'Automatic ({language})', defaultMessage: 'Automatic ({language})' }, { language: nameOf(contentLanguage()) })}</option>
        {[first, ...reported, ...byName].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
}

const useSetting = <T,>(read: () => T, watch: (listener: () => void) => () => void) => {
  const [value, setValue] = useState(read)
  useEffect(() => {
    setValue(read())
    return watch(() => setValue(read()))
  }, [])
  return value
}

/**
 * The player's settings: whether an episode's end opens the next one by itself, and the audio and subtitles a player
 * starts in, which a pick in a player also sets. The play order is on the source cards.
 */
export const PlaybackSection = () => {
  const intl = useIntl()
  const autoplay = useSetting(readAutoplay, watchAutoplay)
  const audio = useSetting(() => settings.getItem(AUDIO_LANGUAGE_KEY), watchTrackLanguages)
  const subtitles = useSetting(() => settings.getItem(SUBTITLE_LANGUAGE_KEY), watchTrackLanguages)
  const always = useSetting(() => readTrackLanguages().alwaysSubtitles === true, watchTrackLanguages)
  return (
    <div css={style}>
      <Switch on={autoplay} set={setAutoplay}>
        {intl.formatMessage({ id: 'Autoplay next episode', defaultMessage: 'Autoplay next episode' })}
      </Switch>
      <LanguageRow
        title={intl.formatMessage({ id: 'Audio language', defaultMessage: 'Audio language' })}
        setting="audio-language"
        value={audio}
        first={{ value: ORIGINAL, label: intl.formatMessage({ id: 'Original#the audio language a work was made in', defaultMessage: 'Original', description: 'the audio language a work was made in' }) }}
        pick={keepAudioLanguage}
      />
      <LanguageRow
        title={intl.formatMessage({ id: 'Subtitle language', defaultMessage: 'Subtitle language' })}
        setting="subtitle-language"
        value={subtitles}
        first={{ value: OFF, label: intl.formatMessage({ id: 'Off#subtitles turned off', defaultMessage: 'Off', description: 'subtitles turned off' }) }}
        pick={language => keepSubtitleLanguage(language === OFF ? null : language)}
      />
      <Switch on={always} set={keepAlwaysSubtitles}>
        {intl.formatMessage({ id: 'Always show subtitles', defaultMessage: 'Always show subtitles' })}
      </Switch>
    </div>
  )
}
