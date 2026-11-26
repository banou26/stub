// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import type { Participant } from '../../../src/social'

import { afterEach, describe, expect, test } from 'vite-plus/test'

const { default: PartyAvatar } = await import('../../../src/components/party-avatar')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const participant = (avatar?: string | null, identicon?: string | null): Participant => ({
  memberId: 'm1',
  self: false,
  status: 'friend',
  identity: {
    handle: 'alice',
    name: 'alice',
    displayName: 'Alice',
    nickname: null,
    avatar: avatar ?? null,
    identicon: identicon ?? null,
    keyChanged: false,
  } as unknown as Participant['identity'],
})

describe('PartyAvatar', () => {
  test('allows data:image/ URIs and falls back to initial for remote https or unsafe URI schemes', () => {
    const dataPng = 'data:image/png;base64,iVBORw0KGgo='
    const dataSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>'
    const pngHost = mount(<PartyAvatar participant={participant(dataPng)} />)
    const svgHost = mount(<PartyAvatar participant={participant(undefined, dataSvg)} />)
    hosts.push(pngHost, svgHost)
    expect(pngHost.querySelector('img')?.getAttribute('src')).toBe(dataPng)
    expect(svgHost.querySelector('img')?.getAttribute('src')).toBe(dataSvg)

    for (const bad of ['https://evil.example/avatar.png', 'http://evil.example/avatar.png', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      const badHost = mount(<PartyAvatar participant={participant(bad)} />)
      hosts.push(badHost)
      expect(badHost.querySelector('img'), bad).toBeNull()
      expect(badHost.textContent, bad).toBe('A')
    }
  })
})
