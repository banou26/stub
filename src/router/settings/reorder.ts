// Pointer events rather than native drag and drop: Firefox for Android and Samsung Internet have none, and iOS
// starts one only on a long press. The drag state is in data attributes, which Preact leaves alone on a render,
// where it would rewrite a class.

const SLOP = 4
const EDGE = 48
const SCROLL = 8

/**
 * The pointerdown handler of a grip inside a list item: the item follows the pointer, the item of the same list
 * under it is marked `data-over`, and a release there calls `drop` with that item's index, once. Escape, a
 * cancelled pointer or a lost capture puts it back with no call, and near the top or bottom of the window the page
 * scrolls. The item's style gives `[data-dragging]` `pointer-events: none`, or the item under the pointer is never
 * found. The list is reordered only by `drop`: a keyed move during the drag would remove the node, and its pointer
 * capture with it.
 */
export const reorder = (drop: (onto: number) => void) => (event: PointerEvent) => {
  if (event.button || !event.isPrimary) return
  event.preventDefault()
  const grip = event.currentTarget as HTMLElement
  const item = grip.closest('li')!
  const list = item.parentElement!
  grip.setPointerCapture(event.pointerId)
  const from = { x: event.clientX, y: event.clientY + scrollY }
  let last = event
  let over: Element | undefined
  let frame = 0

  const mark = (next?: Element) => {
    over?.removeAttribute('data-over')
    over = next
    over?.setAttribute('data-over', '')
  }
  const follow = () => {
    item.setAttribute('data-dragging', '')
    item.style.transform = `translate(${last.clientX - from.x}px, ${last.clientY + scrollY - from.y}px)`
    const under = document.elementFromPoint(last.clientX, last.clientY)?.closest('li')
    mark(under?.parentElement === list ? under : undefined)
    cancelAnimationFrame(frame)
    const step = last.clientY < EDGE ? -SCROLL : last.clientY > innerHeight - EDGE ? SCROLL : 0
    if (step) frame = requestAnimationFrame(() => { scrollBy(0, step); follow() })
  }
  const move = (moved: PointerEvent) => {
    last = moved
    if (item.hasAttribute('data-dragging') || Math.hypot(moved.clientX - event.clientX, moved.clientY - event.clientY) > SLOP) follow()
  }
  const end = (dropped: boolean) => {
    cancelAnimationFrame(frame)
    grip.removeEventListener('pointermove', move)
    grip.removeEventListener('pointerup', up)
    grip.removeEventListener('pointercancel', cancel)
    grip.removeEventListener('lostpointercapture', cancel)
    removeEventListener('keydown', key)
    item.removeAttribute('data-dragging')
    item.style.transform = ''
    const onto = over ? [...list.children].indexOf(over) : -1
    mark()
    if (dropped && onto >= 0) drop(onto)
  }
  const up = () => end(true)
  const cancel = () => end(false)
  const key = (pressed: KeyboardEvent) => { if (pressed.key === 'Escape') cancel() }

  grip.addEventListener('pointermove', move)
  grip.addEventListener('pointerup', up)
  grip.addEventListener('pointercancel', cancel)
  grip.addEventListener('lostpointercapture', cancel)
  addEventListener('keydown', key)
}
