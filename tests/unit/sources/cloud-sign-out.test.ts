// A sign out on the cloud: the site's session lives in FKN's cookie jar, never in stub, so stub asks FKN
// to remove that site's cookies from it (`frame.clearCookies`, @fkn/lib 0.9.42).
import { describe, expect, test, vi } from 'vite-plus/test'

import { clearCloudCookies } from '../../../src/sources/cloud-sign-out'

const fakes = ({ clear = vi.fn(async () => {}), refuse }: { clear?: () => Promise<void>, refuse?: Error } = {}) => {
  const iframe = { kind: 'a hidden iframe' } as unknown as HTMLIFrameElement
  const remove = vi.fn()
  const mount = vi.fn(() => ({ iframe, remove }))
  const clearCookies = vi.fn(clear)
  const attach = vi.fn(async (_options: unknown) => {
    if (refuse) throw refuse
    return { clearCookies }
  })
  return { iframe, remove, mount, attach, clearCookies }
}

describe('a sign out from the cloud jar', () => {
  test("attaches on the app's kept cloud jar, naming the site's domains, and removes every cookie of them", async () => {
    const { iframe, mount, attach, clearCookies, remove } = fakes()
    await clearCloudCookies(['anilist.co'], { attach, mount })

    expect(attach).toHaveBeenCalledWith({ iframe, domains: ['anilist.co'], cookies: 'persistent' })
    expect(clearCookies).toHaveBeenCalledTimes(1)
    expect(clearCookies).toHaveBeenCalledWith()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  test('takes its frame out again when FKN refuses, and says so', async () => {
    const { mount, attach, remove } = fakes({ clear: async () => { throw new Error('frame.clearCookies: the render proxy did not answer within 30000ms') } })
    await expect(clearCloudCookies(['myanimelist.net'], { attach, mount })).rejects.toThrow('did not answer')
    expect(remove).toHaveBeenCalledTimes(1)
  })

  test('takes its frame out when the attach itself fails', async () => {
    const { mount, attach, remove, clearCookies } = fakes({ refuse: new Error('attach failed') })
    await expect(clearCloudCookies(['www.crunchyroll.com'], { attach, mount })).rejects.toThrow('attach failed')
    expect(clearCookies).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledTimes(1)
  })
})
