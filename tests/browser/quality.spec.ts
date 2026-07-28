import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const serverKey = 'server_5d9b5a4cad76f43b'
const sessionPath = `/server/${serverKey}/session/ses_equal`

test.beforeEach(async () => {
  await fetch('http://127.0.0.1:4097/__fixture/reset-requests', { method: 'POST' })
})

test('session decision flow is accessible and keyboard reachable', async ({ page }) => {
  await page.goto(sessionPath)
  await expect(page.getByRole('heading', { name: 'Stateful fixture session' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Requests needing your response' })).toBeVisible()
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')).toEqual([])

  await page.keyboard.press('Home')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
})

test('320px, 200% zoom, reduced motion, and forced colors preserve the shell', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (browserName === 'chromium') await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.goto(sessionPath)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}:${Math.round(element.getBoundingClientRect().right)}`),
  }))
  expect(layout.overflow, layout.offenders.join(', ')).toBeLessThanOrEqual(1)
  await expect(page.getByRole('navigation', { name: 'Session destinations' })).toBeVisible()
})

test('hydration, diagnostics, storage, history, and HTML do not expose configured secrets', async ({ page, request }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  const response = await request.get('/')
  const html = await response.text()
  expect(html).not.toContain('server-secret')
  expect(html).not.toContain('authorization')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /OpenCode/ })).toBeVisible()
  expect(errors).toEqual([])
  expect(page.url()).not.toMatch(/password|token|secret|authorization/i)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/server-secret|authorization/i)
})

test('manifest and service worker define a shell-only cache boundary', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBeTruthy()
  expect(await manifest.json()).toMatchObject({ display: 'standalone', start_url: '/' })
  const worker = await request.get('/service-worker.js')
  const source = await worker.text()
  expect(source).toContain("url.pathname.startsWith('/api/')")
  expect(source).not.toContain("caches.match('/')")
})

test('core stateful journey creates a session and resolves safety requests', async ({ page, request }) => {
  await page.goto('/new')
  await page.getByLabel('Session title').fill('Browser-created session')
  await page.getByRole('button', { name: 'Create session' }).click()
  await expect(page).toHaveURL(/\/session\/ses_created_/)

  await page.goto(sessionPath)
  await page.getByRole('button', { name: 'Allow once' }).click()
  await expect.poll(async () => (await request.get('http://127.0.0.1:4097/__fixture/state')).json()).toMatchObject({ permissions: 0 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Allow edit?' })).toBeHidden()
  await page.getByLabel('Bun').check()
  await page.getByLabel('Types').check()
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByRole('heading', { name: 'The agent needs input' })).toBeHidden()

  await page.getByRole('link', { name: /Changes/ }).click()
  await expect(page.getByRole('heading', { name: /Changes/ })).toBeVisible()
  await page.getByRole('link', { name: 'Files' }).click()
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()
})

test('streamed deltas survive while the full 320-turn history loads', async ({ page, request }) => {
  await request.get('http://127.0.0.1:4097/global/event')
  await page.goto(sessionPath)
  const loadOlder = page.getByRole('button', { name: 'Load older messages' })
  while (await loadOlder.isVisible().catch(() => false)) {
    await page.locator('.timeline-viewport').evaluate((node) => { node.scrollTop = Math.max(0, node.scrollHeight / 2) })
    await loadOlder.evaluate((button: HTMLButtonElement) => button.click())
    await page.waitForFunction(() => !document.body.textContent?.includes('Loading older messages...'))
  }
  await expect(page.locator('.timeline-window')).toHaveAttribute('data-message-count', '320')
  await expect.poll(async () => Number(await page.locator('.timeline-window').getAttribute('data-latest-text-length')), { timeout: 15_000 }).toBeGreaterThanOrEqual('stream:'.length + 160)
})

test('prompt submission reaches the authoritative fixture', async ({ page, request }) => {
  await page.goto(sessionPath)
  await page.getByRole('button', { name: 'Allow once' }).click()
  await expect.poll(async () => (await request.get('http://127.0.0.1:4097/__fixture/state').then((response) => response.json()) as { permissions: number }).permissions, { timeout: 15_000 }).toBe(0)
  await page.reload()
  await page.getByRole('button', { name: 'Reject question' }).click()
  await expect(page.getByRole('complementary', { name: 'Requests needing your response' })).toBeHidden({ timeout: 15_000 })
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Browser prompt')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect.poll(async () => (await request.get('http://127.0.0.1:4097/__fixture/state')).json()).toMatchObject({ prompts: 1 })
})

test('terminal can be created and connected through the WebSocket bridge', async ({ page }) => {
  await page.goto(`${sessionPath}?view=terminal`)
  await page.getByRole('button', { name: 'New terminal' }).click()
  await expect(page.getByText('fixture-ready').first()).toBeVisible()
  await expect(page.getByRole('list', { name: 'Open terminals' })).toBeVisible()
})

test('provider API keys remain server-side', async ({ page, request }) => {
  await page.goto('/settings')
  await page.getByLabel('Spare Provider API key').fill('browser-provider-secret')
  await page.getByRole('listitem').filter({ hasText: 'Spare Provider' }).getByRole('button', { name: 'Connect' }).click()
  await expect.poll(async () => (await request.get('http://127.0.0.1:4097/__fixture/state')).json()).toMatchObject({ providerSecrets: 1 })
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('browser-provider-secret')
})

test('directory picker is a keyboard-contained modal', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Add directory' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Choose a directory' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: 'Parent' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('mobile composer remains visible when focused', async ({ page, request }, testInfo) => {
  test.skip(!['pixel', 'iphone'].includes(testInfo.project.name), 'Mobile viewport journey')
  await page.goto(sessionPath)
  await page.getByRole('button', { name: 'Allow once' }).click()
  await expect.poll(async () => (await request.get('http://127.0.0.1:4097/__fixture/state').then((response) => response.json()) as { permissions: number }).permissions, { timeout: 15_000 }).toBe(0)
  await page.getByRole('button', { name: 'Reject question' }).click()
  await expect.poll(async () => (await request.get('http://127.0.0.1:4097/__fixture/state').then((response) => response.json()) as { questions: number }).questions, { timeout: 15_000 }).toBe(0)
  await expect(page.getByRole('complementary', { name: 'Requests needing your response' })).toBeHidden({ timeout: 15_000 })
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true })
  await prompt.focus()
  const position = await prompt.evaluate((node) => {
    const box = node.getBoundingClientRect()
    return { top: box.top, bottom: box.bottom, viewport: window.visualViewport!.height }
  })
  expect(position.top, JSON.stringify(position)).toBeGreaterThanOrEqual(0)
  expect(position.bottom, JSON.stringify(position)).toBeLessThanOrEqual(position.viewport)
})

test('draft and route restore after reload', async ({ page }) => {
  await page.goto('/new')
  await page.getByLabel('Session title').fill('Persist this draft')
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('opencode-web-lite:new-session-draft:v1:server_5d9b5a4cad76f43b'))).toContain('Persist this draft')
  await page.reload()
  await expect(page.getByLabel('Session title')).toHaveValue('Persist this draft')
  await expect(page).toHaveURL(/\/new$/)
})
