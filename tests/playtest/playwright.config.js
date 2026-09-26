// The Sukhna playtest (tests/playtest/README.md).  `npm run playtest` runs every
// scenario; `npm run playtest -- stairs` runs the files matching "stairs".
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  outputDir: '../../test-results',
  // one browser on the real GPU, one scenario at a time: they share the dev server and the GPU
  workers: 1,
  fullyParallel: false,
  timeout: 15 * 60 * 1000,
  expect: { timeout: 10_000 },
  reporter: [['./reporter.js']],
  use: {
    baseURL: 'http://127.0.0.1:5178',
    // installed Chrome, headed: WebGL on the real GPU, not SwiftShader
    channel: 'chrome',
    headless: false,
    viewport: { width: 1920, height: 1080 },
    launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required', '--window-position=0,0'] },
    actionTimeout: 20_000,
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5178',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
