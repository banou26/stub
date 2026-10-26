import { useEffect, useId, useMemo, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { COUNTRIES, pickCountry, readPickedCountry, viewerCountry, watchPickedCountry, zoneCountry } from '../../sources/country'

/** The country picked in Settings, or undefined for Automatic, read again whenever it changes. */
export const usePickedCountry = () => {
  const [picked, setPicked] = useState(readPickedCountry)
  useEffect(() => {
    setPicked(readPickedCountry())
    return watchPickedCountry(() => setPicked(readPickedCountry()))
  }, [])
  return picked
}

/** The viewer's country, read again whenever the one picked in Settings changes. */
export const useViewerCountry = () => {
  usePickedCountry()
  return viewerCountry()
}

/** The viewer's country, Automatic (the time zone's) until one is picked. */
export const CountryRow = () => {
  const intl = useIntl()
  const picked = usePickedCountry()
  const id = useId()
  const nameOf = (country: string) => intl.formatDisplayName(country, { type: 'region' }) ?? country
  const byName = useMemo(() => {
    const { compare } = new Intl.Collator(intl.locale)
    return COUNTRIES.map(country => ({ country, name: nameOf(country) })).sort((a, b) => compare(a.name, b.name))
  }, [intl])
  return (
    <div className="row" data-setting="country">
      <div className="head">
        <h3 id={id}>{intl.formatMessage({ id: 'Country', defaultMessage: 'Country' })}</h3>
      </div>
      <select aria-labelledby={id} value={picked ?? ''} onChange={event => pickCountry(event.currentTarget.value || undefined)}>
        <option value="">{intl.formatMessage({ id: 'Automatic ({country})', defaultMessage: 'Automatic ({country})' }, { country: nameOf(zoneCountry()) })}</option>
        {byName.map(({ country, name }) => <option key={country} value={country}>{name}</option>)}
      </select>
    </div>
  )
}
