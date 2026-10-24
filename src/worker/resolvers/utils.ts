import sanitizeHtml from 'sanitize-html'
import { marked } from 'marked'
import { LRUCache } from 'lru-cache'

const HTML: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
  allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height'] },
  allowedSchemes: ['http', 'https', 'mailto'],
}
const TEXT: sanitizeHtml.IOptions = { allowedTags: [], allowedAttributes: {} }

const htmlForms = new LRUCache<string, string>({ max: 1000, memoMethod: description => sanitizeHtml(description, HTML) })

// a text opening "2018. After..." would be a list numbered from 2018, its year gone from the text. Markdown still reads
// the list after blank lines and up to three spaces; four start a code block, where the backslash would show. The
// sanitizer writes the text's &, < and > as HTML does, and plain text wants them as they are
const textForms = new LRUCache<string, string>({
  max: 1000,
  memoMethod: description =>
    sanitizeHtml(marked.parse(description.replace(/^((?:\s*\n)? {0,3}\d+)\./, '$1\\.'), { async: false }), TEXT)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
})

/**
 * A source's description as HTML a page may draw as it is: its text, formatting, links and remote images, without
 * scripts, handlers, styles, forms, or an address with a scheme other than http, https or mailto.
 */
export const descriptionHtml = (description: string) => htmlForms.memo(description)

/** A source's description as plain text, its Markdown read. */
export const descriptionText = (description: string) => textForms.memo(description)

/** `description` in the form a resolver's `type` asks for: HTML, or plain text for TEXT or no type. */
export const descriptionAs = (description: string, type?: 'HTML' | 'TEXT' | null) =>
  type === 'HTML' ? descriptionHtml(description) : descriptionText(description)
