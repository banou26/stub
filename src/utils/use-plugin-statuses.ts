import type { IntlShape } from 'react-intl'

import { useEffect, useState } from 'preact/hooks'

import { NAME_LIST } from '../i18n'
import { onPluginsChange, pluginStatuses, type PluginStatus } from '../plugins'

/** What a package is called: the sources it registered, or its address until it has connected. */
export const pluginName = (intl: IntlShape, { uri, sources = [] }: Pick<PluginStatus, 'uri' | 'sources'>): string =>
  sources.length ? intl.formatList(sources.map(source => source.name), NAME_LIST) : uri.replace(/^npm:/, '')

/** The added sources and their states, kept current. */
export const usePluginStatuses = (): PluginStatus[] => {
  const [statuses, setStatuses] = useState(pluginStatuses)
  // read again on subscribe: a source whose frame was warm connects before the effect runs
  useEffect(() => {
    const read = () => setStatuses(pluginStatuses())
    read()
    return onPluginsChange(read)
  }, [])
  return statuses
}
