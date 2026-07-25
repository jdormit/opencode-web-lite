import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const path of ['/', '/new', '/settings']) {
  test(`${path} renders useful SSR content and has no serious accessibility violations`, async ({
    page,
    request,
  }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    const response = await request.get(path)
    const html = await response.text()

    expect(response.ok()).toBeTruthy()
    expect(html).toContain('<main')
    expect(html).toContain('OpenCode')

    await page.goto(path)
    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/)
    const results = await new AxeBuilder({ page }).analyze()
    expect(
      results.violations.filter(({ impact }) =>
        impact === 'serious' || impact === 'critical',
      ),
    ).toEqual([])
    expect(consoleErrors).toEqual([])
  })
}

test('mobile shell fits the viewport and navigation remains available', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()

  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  }
})

test('invalid session identifiers render the not-found boundary', async ({ page }) => {
  const response = await page.goto('/server/invalid%20key/session/session')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: strings.errors.notFoundTitle })).toBeVisible()
})

const strings = {
  errors: { notFoundTitle: 'This page is not here.' },
}
