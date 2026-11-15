import { useEffect, useState } from 'preact/hooks'

/** A setting's value as `read` answers it, read again whenever `watch` says it changed. */
export const useSetting = <T,>(read: () => T, watch: (listener: () => void) => () => void) => {
  const [value, setValue] = useState(read)
  useEffect(() => {
    setValue(read())
    return watch(() => setValue(read()))
  }, [])
  return value
}
