import { useEffect, useState } from 'preact/hooks'

import { onPluginsChange, pluginStatuses, type PluginStatus } from '../plugins'

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
