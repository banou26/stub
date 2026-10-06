/** Where stub kept the API keys viewers pasted, until every source read without one (2026-10-07). */
export const LEGACY_API_KEYS_KEY = 'stub.apikeys'

/** Removes the keys a viewer pasted from this browser: nothing reads them any more, and they are the viewer's secrets. */
export const forgetApiKeys = (storage: () => Pick<Storage, 'removeItem'> = () => localStorage): void => {
  try { storage().removeItem(LEGACY_API_KEYS_KEY) } catch {}
}
