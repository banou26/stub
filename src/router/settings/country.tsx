import { useEffect, useId, useState } from 'preact/hooks'

import { COUNTRIES, pickCountry, readPickedCountry, viewerCountry, watchPickedCountry, zoneCountry } from '../../sources/country'

const regions = new Intl.DisplayNames(['en'], { type: 'region' })
const nameOf = (country: string) => regions.of(country) ?? country
const BY_NAME = [...COUNTRIES].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))

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
  const picked = usePickedCountry()
  const id = useId()
  return (
    <div className="row" data-setting="country">
      <div className="head">
        <h3 id={id}>Country</h3>
      </div>
      <select aria-labelledby={id} value={picked ?? ''} onChange={event => pickCountry(event.currentTarget.value || undefined)}>
        <option value="">Automatic ({nameOf(zoneCountry())})</option>
        {BY_NAME.map(country => <option key={country} value={country}>{nameOf(country)}</option>)}
      </select>
    </div>
  )
}
