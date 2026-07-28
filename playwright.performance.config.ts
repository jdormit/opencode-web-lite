import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/performance',
  outputDir: '.test-results/performance',
  timeout: 120_000,
  workers: 1,
  projects: [{ name: 'chromium-performance', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: [
    { command: 'bun tests/fixtures/mock-opencode.ts', url: 'http://127.0.0.1:4097/global/health', reuseExistingServer: !process.env.CI },
    { command: 'OPENCODE_SERVER_URL=http://127.0.0.1:4097 bun run start', url: 'http://127.0.0.1:3000/readyz', reuseExistingServer: !process.env.CI },
  ],
})
