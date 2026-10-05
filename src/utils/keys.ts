import { setUserKeys } from '../worker'
import { API_KEYS_KEY } from '../sources/key-configs'

export const loadKeys = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(API_KEYS_KEY)
    return raw ? JSON.parse(raw) as Record<string, string> : {}
  } catch {
    return {}
  }
}

export const pushKeys = (keys: Record<string, string> = loadKeys()) => setUserKeys(keys)

export const saveKeys = (keys: Record<string, string>) => {
  const pruned = Object.fromEntries(Object.entries(keys).filter(([, value]) => value))
  localStorage.setItem(API_KEYS_KEY, JSON.stringify(pruned))
  return pushKeys(pruned)
}

/** Forgets every key, in this browser and in the worker, so no source is asked with one again. */
export const clearKeys = () => {
  try { localStorage.removeItem(API_KEYS_KEY) } catch {}
  return pushKeys({})
}
