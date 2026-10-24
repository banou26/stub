import { marked } from 'marked'
import { parseHTML } from 'linkedom'
import { LRUCache } from 'lru-cache'

const innerHTMLCache = new LRUCache<string, string>({ max: 1000 })
const textContentCache = new LRUCache<string, string>({ max: 1000 })

// a text opening "2018. After..." would be a list numbered from 2018, its year gone from the text. Markdown still reads
// the list after blank lines and up to three spaces; four start a code block, where the backslash would show
const parseDescription = (text: string) => {
  const html = marked.parse(text.replace(/^((?:\s*\n)? {0,3}\d+)\./, '$1\\.'), { async: false })
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
