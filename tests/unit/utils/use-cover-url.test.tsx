// FIRST: ../components/dom installs the document preact renders into.
import { mount, unmount } from '../components/dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

const { useCoverUrl } = await import('../../../src/utils/use-cover-url')

// linkedom has no Image, which the cover probe loads each cover with
beforeEach(() => { vi.stubGlobal('Image', class { onload?: () => void; set src (_: string) { setTimeout(() => this.onload?.()) } }) })

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

type Owner = { _id: string, covers: { url: string }[], handles: { relation: string, node: { uri: string } }[] }

const owner = (_id: string, covers: string[], handles: string[]): Owner => ({
  _id,
  covers: covers.map(url => ({ url })),
  handles: handles.map(handle => ({ relation: handle.split(' ')[0]!, node: { uri: handle.split(' ')[1]! } })),
})
const show = (covers: string[]) => owner('cl:jw:131317', covers, ['SAME_AS jw:131317'])
const season = owner('cl:jw:131317-1', [], ['SAME_AS jw:131317-1', 'PART_OF jw:131317'])

// as the title page and the modal draw their cover: a navigation to a season starts from its own covers
const Cover = ({ media }: { media: Owner }) => <i data-cover={useCoverUrl(media.covers, media)}/>

const page = async (first: Owner) => {
  const host = mount(<Cover media={first}/>)
  hosts.push(host)
  const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 10)))
  await settle()
  return {
    cover: () => host.querySelector('i')!.getAttribute('data-cover'),
    update: async (next: Owner) => {
      act(() => { render(<Cover media={next}/>, host) })
      await settle()
    },
  }
}

test('a cover drawn for a page keeps it through a later answer with none', async () => {
  const { cover, update } = await page(show(['https://images.justwatch.com/poster/slow-horses.jpg']))
  await update(show([]))
  expect(cover()).toBe('https://images.justwatch.com/poster/slow-horses.jpg')
})

test('a cover drawn for a page carries no show\'s poster onto a season of it', async () => {
  const { cover, update } = await page(show(['https://images.justwatch.com/poster/slow-horses.jpg']))
  await update(season)
  expect(cover()).toBeNull()
})
