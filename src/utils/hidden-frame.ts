/**
 * A new iframe in the document, out of sight, for an FKN attachment the viewer never looks at, and how to
 * take it out again. Clipped rather than `display: none`, the way FKN hides its own broker frame, so the
 * page in it runs laid out like any other.
 */
export const mountHiddenFrame = (title: string) => {
  const iframe = document.createElement('iframe')
  iframe.title = title
  iframe.tabIndex = -1
  iframe.setAttribute('aria-hidden', 'true')
  iframe.referrerPolicy = 'no-referrer'
  iframe.style.cssText = 'position: fixed; top: 0; left: 0; width: 400px; height: 300px; border: 0; clip-path: inset(100%); pointer-events: none;'
  document.body.appendChild(iframe)
  return { iframe, remove: () => iframe.remove() }
}
