import { useEffect } from 'preact/hooks'

import { getRoutePath, Route } from '../router/path'

/**
 * Names the title page of the work at `uri`, under its `name`, as the calling page's one address, in a
 * `<link rel="canonical">`, while the page is drawn with a name. It is the address the link preview Function names for
 * the work, and a link the Function wrote is taken over rather than doubled.
 */
export const useCanonical = (uri?: string, name?: string) => {
  useEffect(() => {
    if (!uri || !name) return
    const link = document.head.querySelector('link[rel="canonical"]') ?? document.createElement('link')
    link.setAttribute('rel', 'canonical')
    link.setAttribute('href', new URL(getRoutePath(Route.TITLE, { uri, name }), location.origin).href)
    document.head.append(link)
    return () => link.remove()
  }, [uri, name])
}
