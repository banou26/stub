// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

vi.mock('lucide-react', () => {
  const icon = (name: string) => () => <svg data-icon={name}/>
  return { Volume: icon('Volume'), Volume1: icon('Volume1'), Volume2: icon('Volume2'), VolumeX: icon('VolumeX') }
})

const { VolumeControl } = await import('../../../src/components/volume-control')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const press = (target: Element, key: string) => {
  const event = Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key })
  act(() => { target.dispatchEvent(event) })
  return event
}

test('the mute button exposes its state as an accessible name and toggles muted on press', () => {
  const mutedUpdates: boolean[] = []
  const host = mount(withIntl(
    <VolumeControl
      defaultMuted={true}
      defaultVolume={0.5}
      onMutedUpdate={muted => mutedUpdates.push(muted)}
      onVolumeUpdate={() => {}}
    />
  ))
  hosts.push(host)

  const button = host.querySelector('button.volume-icon')!
  const slider = host.querySelector('[role="slider"]')!
  expect(button.getAttribute('type')).toBe('button')
  expect(button.getAttribute('aria-label')).toBe('Unmute')
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(slider.getAttribute('aria-valuenow')).toBe('0')

  act(() => { button.dispatchEvent(new Event('click', { bubbles: true })) })
  expect(mutedUpdates).toEqual([false])
  expect(button.getAttribute('aria-label')).toBe('Mute')
  expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(slider.getAttribute('aria-valuenow')).toBe('50')

  act(() => { button.dispatchEvent(new Event('click', { bubbles: true })) })
  expect(mutedUpdates).toEqual([false, true])
  expect(button.getAttribute('aria-label')).toBe('Unmute')
})

test('the volume slider exposes ARIA range attributes and adjusts volume with keyboard keys', () => {
  const mutedUpdates: boolean[] = []
  const volumeUpdates: Array<[number, number]> = []
  const host = mount(withIntl(
    <VolumeControl
      defaultMuted={true}
      defaultVolume={0.4}
      onMutedUpdate={muted => mutedUpdates.push(muted)}
      onVolumeUpdate={(adjusted, raw) => volumeUpdates.push([adjusted, raw])}
    />
  ))
  hosts.push(host)

  const slider = host.querySelector('[role="slider"]')!
  expect(slider.getAttribute('tabIndex')).toBe('0')
  expect(slider.getAttribute('aria-label')).toBe('Volume')
  expect(slider.getAttribute('aria-valuemin')).toBe('0')
  expect(slider.getAttribute('aria-valuemax')).toBe('100')
  expect(slider.getAttribute('aria-valuenow')).toBe('0')

  const arrowRight = press(slider, 'ArrowRight')
  expect(arrowRight.defaultPrevented).toBe(true)
  expect(slider.getAttribute('aria-valuenow')).toBe('5')
  expect(mutedUpdates).toEqual([false])
  expect(volumeUpdates.at(-1)).toEqual([0.05 ** 2, 0.05])

  press(slider, 'End')
  expect(slider.getAttribute('aria-valuenow')).toBe('100')
  expect(volumeUpdates.at(-1)).toEqual([1, 1])

  press(slider, 'Home')
  expect(slider.getAttribute('aria-valuenow')).toBe('0')
  expect(mutedUpdates).toEqual([false, true])
  expect(volumeUpdates.at(-1)).toEqual([0, 0])

  press(slider, 'ArrowUp')
  expect(slider.getAttribute('aria-valuenow')).toBe('5')
  expect(mutedUpdates).toEqual([false, true, false])

  press(slider, 'ArrowLeft')
  expect(slider.getAttribute('aria-valuenow')).toBe('0')
  expect(mutedUpdates).toEqual([false, true, false, true])
})
