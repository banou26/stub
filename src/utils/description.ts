import DOMPurify from 'dompurify'

/**
 * A source's description HTML as the page may draw it: its text, formatting and links, without scripts, handlers,
 * styles or forms. Runs on the main thread, since DOMPurify on the worker's linkedom returns its input unchanged.
 */
export const sanitizeDescription = (html: string) =>
  DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form'], FORBID_ATTR: ['style'] })
