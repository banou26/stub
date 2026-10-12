import { onTestFinished, vi } from 'vite-plus/test'

/** The rest of this test runs as a viewer in `timeZone`, which is what the extractor reads the country off. */
export const viewerIn = (timeZone: string) => {
  vi.stubEnv('TZ', timeZone)
  onTestFinished(() => { vi.unstubAllEnvs() })
}
