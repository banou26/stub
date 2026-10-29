// FIRST, and it has to stay first: ./dom installs the document that @emotion/react reads at module
// scope. See the file for what happens when it does not.
import { button, mount, unmount, withIntl } from './dom'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router, useLocation } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import ErrorBoundary from '../../../src/components/error-boundary'

// The whole point of the boundary is that a render time throw stops being permanent DOM corruption,
// so every test here drives a REAL render of a child that really throws, rather than reading the
// source. The control in the first describe is what proves the rig can see the failure at all:
// without the boundary the same child takes the render down.

const Sibling = () => <p className="sibling">still here</p>

const hosts: HTMLElement[] = []

const mountTracked = (vnode: Parameters<typeof mount>[0]) => {
  const host = mount(withIntl(vnode))
  hosts.push(host)
  return host
}

let errors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
})

describe('a child that throws', () => {
  const thrown = new Error('the media modal exploded')
  const Throws = () => { throw thrown }

  // CONTROL: unguarded, the throw comes straight back out of `render`. A rig that could not see this
  // would report the boundary working while proving nothing, since every assertion below is about
  // what happens INSTEAD of this.
  test('takes the whole render down when nothing catches it', () => {
    const { hook } = memoryLocation({ path: '/a' })
    expect(() => mountTracked(<Router hook={hook}><Throws/></Router>)).toThrow('the media modal exploded')
  })

  test('renders the fallback with its message, and leaves the rest of the document alone', () => {
    const { hook } = memoryLocation({ path: '/a' })
    const host = mountTracked(
      <Router hook={hook}>
        <Sibling/>
        <ErrorBoundary><Throws/></ErrorBoundary>
      </Router>
    )

    expect(host.textContent).toContain('This page failed to render')
    expect(host.textContent).toContain('the media modal exploded')
    expect(button(host, 'Reload')).toBeTruthy()
    expect(button(host, 'Copy details')).toBeTruthy()
    expect(host.querySelector('.sibling')?.textContent, 'a sibling of the boundary is untouched').toBe('still here')
  })

  test('is logged once, as the app logs everything else: an Error naming the route, over a cause', () => {
    const { hook } = memoryLocation({ path: '/media/anilist:1' })
    mountTracked(<Router hook={hook}><ErrorBoundary><Throws/></ErrorBoundary></Router>)

    expect(errors).toHaveBeenCalledTimes(1)
    const logged = errors.mock.calls[0]?.[0] as Error
    expect(logged).toBeInstanceOf(Error)
    expect(logged.message).toContain('/media/anilist:1')
    expect(logged.cause).toBe(thrown)
  })
})

describe('the copy button', () => {
  const thrown = new Error('boom')
  const Throws = () => { throw thrown }

  test('puts the message, the stack and the route on the clipboard', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText } }, configurable: true })

    const { hook } = memoryLocation({ path: '/media/anilist:1' })
    const host = mountTracked(<Router hook={hook}><ErrorBoundary><Throws/></ErrorBoundary></Router>)

    await act(async () => { button(host, 'Copy details')!.click() })

    expect(writeText).toHaveBeenCalledTimes(1)
    const details = writeText.mock.calls[0]![0]
    expect(details).toContain('boom')
    expect(details, 'the stack, whole').toContain(thrown.stack)
    expect(details, 'the route the throw happened on').toContain('/media/anilist:1')
    expect(button(host, 'Copied'), 'the button says so once the write settles').toBeTruthy()
  })
})

describe('a route change', () => {
  let brokenRoutes = new Set<string>()
  const Page = () => {
    const [route] = useLocation()
    if (brokenRoutes.has(route)) throw new Error(`${route} is broken`)
    return <p className="page">{route} rendered</p>
  }

  beforeEach(() => { brokenRoutes = new Set(['/a']) })

  /**
   * The reset. A throw on one page walling every other page for the rest of the session is the
   * failure this boundary exists to prevent, so the caught error has to be dropped when the route
   * changes rather than held until a reload.
   */
  test('clears a caught error, and a page that throws does not wall the next one', () => {
    const { hook, navigate } = memoryLocation({ path: '/a' })
    const host = mountTracked(<Router hook={hook}><ErrorBoundary><Page/></ErrorBoundary></Router>)
    expect(host.textContent).toContain('This page failed to render')

    act(() => { navigate('/b') })
    expect(host.textContent, '/b renders its own content').toContain('/b rendered')
    expect(host.textContent).not.toContain('This page failed to render')

    brokenRoutes.delete('/a')
    act(() => { navigate('/a') })
    expect(host.textContent, 'and /a renders once it stops throwing').toContain('/a rendered')
  })
})

describe('mounted with no Router above it', () => {
  // The shape src/index.tsx uses: the boundary wraps the router, so it is OUTSIDE wouter's own
  // `<Router>` and falls back to wouter's default router, which reads the browser location. That
  // fallback is the whole mount, and it is worth one test that it exists.
  const browser = { location: { pathname: '/watch/anilist:1', search: '' } }

  beforeEach(() => {
    const events = globalThis.window as unknown as EventTarget
    Object.assign(globalThis, {
      ...browser,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    })
  })

  afterEach(() => { Reflect.deleteProperty(globalThis, 'location') })

  test('still catches, and still names the route', () => {
    const thrown = new Error('unrouted boom')
    const Throws = () => { throw thrown }
    const host = mountTracked(<ErrorBoundary><Throws/></ErrorBoundary>)

    expect(host.textContent).toContain('This page failed to render')
    expect(host.textContent).toContain('unrouted boom')
    expect((errors.mock.calls[0]?.[0] as Error).message).toContain('/watch/anilist:1')
  })
})

describe('a child that does not throw', () => {
  test('renders unchanged, and nothing is logged', () => {
    const { hook } = memoryLocation({ path: '/a' })
    const host = mountTracked(
      <Router hook={hook}><ErrorBoundary><p className="page">the page</p></ErrorBoundary></Router>
    )

    expect(host.innerHTML, 'the boundary adds no element of its own').toBe('<p class="page">the page</p>')
    expect(errors).not.toHaveBeenCalled()
  })
})
