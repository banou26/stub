import type { RefObject } from 'preact'

import { ScanSearch } from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'preact/compat'
import { useIntl } from 'react-intl'
import { useLocation, useSearch } from 'wouter'

import { pictureCode } from '../../scene/code'
import { getRoutePath, Route } from '../path'
import { sceneOf, scenePath } from './params'

// The address at which the last picture could not be read. Shared, since the header's bar sends a picture from any page
// and the search page is where that is said.
let unreadableAt: string | undefined
const watchers = new Set<() => void>()
const setUnreadableAt = (at: string | undefined) => {
  unreadableAt = at
  for (const watcher of watchers) watcher()
}
const watch = (watcher: () => void) => {
  watchers.add(watcher)
  return () => { watchers.delete(watcher) }
}

/**
 * The scene search of a picture, for the header's bar and the search page alike: its address is a new step, or
 * replaces the search page's when it is the code already shown. A picture the browser cannot read opens the search
 * page, where `unreadable` holds until the address moves on.
 */
export const usePictureSearch = () => {
  const [path, navigate] = useLocation()
  const search = useSearch()
  const here = `${path}?${search}`
  const onSearch = path === getRoutePath(Route.SEARCH)
  const unreadable = useSyncExternalStore(watch, () => unreadableAt === here)
  useEffect(() => {
    if (unreadableAt !== undefined && unreadableAt !== here) setUnreadableAt(undefined)
  }, [here])
  const searchPicture = (file: File) => {
    // a focused field keeps its words over a new address, so it lets go for the scene search to show in it
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.matches('input')) focused.blur()
    setUnreadableAt(undefined)
    void pictureCode(file).then(
      code => navigate(scenePath(code), { replace: onSearch && code === sceneOf(search) }),
      () => {
        if (!onSearch) navigate(getRoutePath(Route.SEARCH))
        setUnreadableAt(onSearch ? here : `${getRoutePath(Route.SEARCH)}?`)
      },
    )
  }
  return { searchPicture, unreadable }
}

// Safari's Copy Image puts the picture's address beside it as its text (WebKit's writableTypesForImage), where Word and
// Excel put words. Chrome's and Firefox's put no text.
const words = (data: DataTransfer) =>
  data.types.includes('text/plain') && !/^(https?|data|blob|file):\S+$/.test(data.getData('text/plain'))

/**
 * Calls `onPicture` with a file pasted or dropped on `area`, the whole page when there is none, while `enabled`. A
 * paste that carries words is left to the field, even with a file beside it: Word and Excel copy a picture of the
 * selection next to its text.
 */
export const usePictureInput = (onPicture: (file: File) => void, enabled: boolean, area?: RefObject<HTMLElement | null>) => {
  const latest = useRef(onPicture)
  latest.current = onPicture
  useEffect(() => {
    const target: GlobalEventHandlers | null = area ? area.current : document
    if (!enabled || !target) return
    const paste = (event: ClipboardEvent) => {
      const file = event.clipboardData?.files[0]
      if (!file || words(event.clipboardData!)) return
      event.preventDefault()
      latest.current(file)
    }
    // a page that refuses the drag lets the browser open the file in its place
    const dragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      const file = event.dataTransfer?.files[0]
      if (!file) return
      event.preventDefault()
      latest.current(file)
    }
    target.addEventListener('paste', paste)
    target.addEventListener('dragover', dragOver)
    target.addEventListener('drop', drop)
    return () => {
      target.removeEventListener('paste', paste)
      target.removeEventListener('dragover', dragOver)
      target.removeEventListener('drop', drop)
    }
  }, [enabled])
}

/** The search field's button that picks a picture to search by, its icon at `size` to match the icons beside it. */
export const PictureButton = ({ onPicture, size }: { onPicture: (file: File) => void, size: number }) => {
  const label = useIntl().formatMessage({ id: 'Search by picture', defaultMessage: 'Search by picture' })
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        className="picture"
        aria-label={label}
        title={label}
        // keeps the field focused through the press, so the header's phone field does not close under the finger
        onPointerDown={event => event.preventDefault()}
        onClick={() => input.current?.click()}
      >
        <ScanSearch size={size}/>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) onPicture(file)
        }}
      />
    </>
  )
}
