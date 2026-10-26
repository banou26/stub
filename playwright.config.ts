import { defineConfig } from '@playwright/test'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'

const detectChromePath = (): string | undefined => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (!existsSync('/etc/NIXOS')) return undefined
  for (const bin of ['google-chrome-stable', 'chromium']) {
    try {
      return execFileSync('which', [bin], { encoding: 'utf-8' }).trim()
    } catch {}
  }
  return undefined
}

export default defineConfig({
  // Both suites live under tests/, so the split is by suffix: .spec.ts is the browser rig, .test.ts
  // is vitest. testMatch is what enforces it; without it playwright collects tests/unit and dies
  // trying to run describe() from the wrong runner.
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  use: {
    // the browser's language is what stub's text follows, so a runner's own never changes what a test reads
    locale: 'en-US',
    launchOptions: {
      executablePath: detectChromePath(),
      // this is the owner's machine: no run gets to make noise on it, headless or not
      args: ['--mute-audio'],
    },
  },
  webServer: {
    command: 'npm run test-server',
    url: 'http://localhost:7357',
    stdout: 'ignore',
    stderr: 'pipe'
  }
})
