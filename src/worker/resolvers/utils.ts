import { marked } from 'marked'
import { parseHTML } from 'linkedom'
import { LRUCache } from 'lru-cache'

const innerHTMLCache = new LRUCache<string, string>({ max: 1000 })
const textContentCache = new LRUCache<string, string>({ max: 1000 })

const parseDescription = (text: string) => {
  const html = marked.parse(text, { async: false })
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`)
  const innerHTML = document.body?.innerHTML ?? html
  const textContent = document.body?.textContent ?? html
  innerHTMLCache.set(text, innerHTML)
  textContentCache.set(text, textContent)
  return { innerHTML, textContent }
}

/** A description's Markdown as HTML, unsanitized: the page sanitizes what it draws. */
export const parseHTMLDescription = (text: string) => innerHTMLCache.get(text) ?? parseDescription(text).innerHTML

export const parseTextDescription = (text: string) => textContentCache.get(text) ?? parseDescription(text).textContent
