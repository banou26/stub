import { act } from 'preact/test-utils'

import { expandPath, SHORT_PATH } from '../../../src/utils/share-link'

const swap = (name: string, value: unknown) => {
  const had = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  return () => {
    if (had) Object.defineProperty(globalThis, name, had)
    else delete (globalThis as Record<string, unknown>)[name]
  }
}

/**
 * Clicks a Share button as a page at `href` would in a browser with no share sheet, and gives the link it copied and
 * the address that link opens.
 */
export const share = async (button: Element | null | undefined, href: string) => {
  const copied: string[] = []
  const restore = [
    swap('location', new URL(href)),
    swap('navigator', { clipboard: { writeText: async (text: string) => { copied.push(text) } } }),
  ]
  try {
    await act(async () => { (button as HTMLElement).click() })
  } finally {
    for (const undo of restore) undo()
  }
  const link = copied[0]!
  const { origin, pathname } = new URL(link)
  return { link, opens: pathname.startsWith(SHORT_PATH) ? `${origin}${expandPath(pathname.slice(SHORT_PATH.length))}` : link }
}
