import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  outputDir: '.test-results',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  workers: 1,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
  ],
  webServer: [
    {
      command: 'bun tests/fixtures/mock-opencode.ts',
      url: 'http://127.0.0.1:4097/global/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'bun run build && OPENCODE_SERVER_URL=http://127.0.0.1:4097 bun run start',
      url: 'http://127.0.0.1:3000/readyz',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
