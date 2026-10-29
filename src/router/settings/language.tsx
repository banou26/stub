import { useMemo, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { automaticLanguage, OFFERED, pickLanguage, readPickedLanguage } from '../../i18n'

// CLDR names a language as written mid-sentence (`français`); a menu starts it with a capital, as CLDR's
// uiListOrMenu context does for these languages
const ownName = (tag: string) => {
  const name = new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag
  return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1)
}

/**
 * The language stub's text is shown in: Automatic, naming the language the browser's give, then each offered one in
 * its own name. A pick reloads the tab once `saved` (the FKN account's settings step) settles.
 */
export const LanguageSection = ({ saved, reload = () => location.reload() }: { saved: () => Promise<unknown>, reload?: () => void }) => {
  const intl = useIntl()
  const [picking, setPicking] = useState(false)
  const byName = useMemo(() => {
    const { compare } = new Intl.Collator(intl.locale)
    return OFFERED.map(tag => ({ tag, name: ownName(tag) })).sort((a, b) => compare(a.name, b.name))
  }, [intl])
  const automatic = automaticLanguage()
  return (
    <div className="row" data-setting="language">
      <select
        aria-labelledby="settings-section-title"
        value={readPickedLanguage() ?? ''}
        disabled={picking}
        onChange={event => {
          setPicking(true)
          void pickLanguage(event.currentTarget.value || undefined, { saved, reload })
        }}
      >
        <option value="">{intl.formatMessage({ id: 'Automatic ({language})', defaultMessage: 'Automatic ({language})' }, { language: ownName(automatic) })}</option>
        {byName.map(({ tag, name }) => <option key={tag} value={tag} lang={tag}>{name}</option>)}
      </select>
    </div>
  )
}
