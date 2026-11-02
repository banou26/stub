import { useEffect } from 'preact/hooks'

// the name index.html gives the tab, read before anything here renames it
const APP_NAME = document.title

/** Names the tab `<name> - Stub` while the calling page is drawn with a name, and `Stub` again without one or once it is gone. */
export const useDocumentTitle = (name?: string) => {
  useEffect(() => {
    document.title = name ? `${name} - ${APP_NAME}` : APP_NAME
    return () => { document.title = APP_NAME }
  }, [name])
}
