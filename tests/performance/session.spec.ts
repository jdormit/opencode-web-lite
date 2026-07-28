import { expect, test } from '@playwright/test'
import baseline from './baseline.json' with { type: 'json' }

const path = '/server/server_5d9b5a4cad76f43b/session/ses_equal'

test('production session meets synthetic median budgets', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.addInitScript(() => {
    const metrics = { cls: 0, lcp: 0, runtimeStart: Infinity, longTasks: [] as number[], events: [] as number[], frameGaps: [] as number[] }
    ;(window as unknown as { __qualityMetrics: typeof metrics }).__qualityMetrics = metrics
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean }
        if (!shift.hadRecentInput) metrics.cls += shift.value ?? 0
      }
    }).observe({ type: 'layout-shift', buffered: true })
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.startTime >= metrics.runtimeStart) metrics.longTasks.push(entry.duration) })
      .observe({ type: 'longtask', buffered: true })
    new PerformanceObserver((list) => { metrics.lcp = list.getEntries().at(-1)?.startTime ?? metrics.lcp })
      .observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) metrics.events.push(entry.duration) })
      .observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit)
    const startFrames = () => {
      let previous = performance.now()
      const sample = (current: number) => {
        if (current >= metrics.runtimeStart) metrics.frameGaps.push(current - previous)
        previous = current
        if (metrics.frameGaps.length < 300) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }
    addEventListener('DOMContentLoaded', startFrames, { once: true })
  })
  const runs: Array<Record<string, number>> = []
  for (let run = 0; run < 6; run += 1) {
    await fetch('http://127.0.0.1:4097/__fixture/prepare-events', { method: 'POST' })
    await context.clearCookies()
    await cdp.send('Network.clearBrowserCache')
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Stateful fixture session' })).toBeVisible()
    await page.waitForTimeout(2_000)
    await page.evaluate(() => {
      const observed = (window as unknown as { __qualityMetrics: { runtimeStart: number; longTasks: number[]; frameGaps: number[] } }).__qualityMetrics
      observed.runtimeStart = performance.now(); observed.longTasks = []; observed.frameGaps = []
      const target = document.querySelector('.timeline-window')
      ;(window as unknown as { __streamComplete: Promise<void> }).__streamComplete = new Promise((resolve) => {
        if (!target) return
        const complete = () => Number(target.getAttribute('data-latest-text-length')) >= 'stream:'.length + 160
        if (complete()) { resolve(); return }
        const observer = new MutationObserver(() => {
          if (!complete()) return
          observer.disconnect(); resolve()
        })
        observer.observe(target, { attributes: true, attributeFilter: ['data-latest-text-length'] })
      })
    })
    await fetch('http://127.0.0.1:4097/__fixture/release-events', { method: 'POST' })
    await page.evaluate(() => (window as unknown as { __streamComplete: Promise<void> }).__streamComplete)
    await fetch('http://127.0.0.1:4097/__fixture/pause-events', { method: 'POST' })
    const metrics = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      const paints = performance.getEntriesByType('paint')
      const fcp = paints.find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? Infinity
      const observed = (window as unknown as { __qualityMetrics: { cls: number; lcp: number; longTasks: number[]; frameGaps: number[] } }).__qualityMetrics
      const sortedLongTasks = [...observed.longTasks].sort((a, b) => a - b)
      const sortedGaps = [...observed.frameGaps].sort((a, b) => a - b)
      return {
        ttfb: navigation.responseStart, fcp, lcp: observed.lcp || fcp, cls: observed.cls,
        longTaskMax: sortedLongTasks.at(-1) ?? 0,
        longTaskP95: sortedLongTasks[Math.floor(sortedLongTasks.length * 0.95)] ?? 0,
        frameGapP95: sortedGaps[Math.floor(sortedGaps.length * 0.95)] ?? 0,
      }
    })
    if (run) runs.push(metrics)
  }
  const median = (key: string) => runs.map((run) => run[key]!).sort((a, b) => a - b)[2]!
  const report = { ttfb: median('ttfb'), fcp: median('fcp'), lcp: median('lcp'), cls: median('cls'), runs }
  const loadOlder = page.getByRole('button', { name: 'Load older messages' })
  while (await loadOlder.isVisible().catch(() => false)) {
    await loadOlder.click()
    await page.waitForFunction(() => !document.body.textContent?.includes('Loading older messages...'))
  }
  await expect(page.locator('.timeline-window')).toHaveAttribute('data-message-count', '320')
  const interactionEventStart = await page.evaluate(() => (window as unknown as { __qualityMetrics: { events: number[] } }).__qualityMetrics.events.length)
  await page.getByRole('button', { name: 'Session actions' }).click()
  await expect(page.locator('.session-actions')).toBeVisible()
  const runtime = await page.evaluate((eventStart) => {
    const observed = (window as unknown as { __qualityMetrics: { events: number[] } }).__qualityMetrics
    return { interaction: Math.max(...observed.events.slice(eventStart), 0) }
  }, interactionEventStart)
  const protectedMetrics = {
    ...report,
    interaction: runtime.interaction,
    frameGapP95: median('frameGapP95'),
    longTaskMax: median('longTaskMax'),
    longTaskP95: median('longTaskP95'),
  }
  console.log(JSON.stringify({ event: 'performance-budget', ...protectedMetrics }))
  for (const [name, value] of Object.entries(protectedMetrics)) {
    if (name === 'runs') continue
    expect(value, `${name} regressed by more than 10% from its checked-in median baseline`)
      .toBeLessThanOrEqual(baseline[name as keyof typeof baseline] * 1.1)
  }
  expect(report.ttfb).toBeLessThanOrEqual(800)
  expect(report.fcp).toBeLessThanOrEqual(1_800)
  expect(report.lcp).toBeLessThanOrEqual(2_500)
  expect(report.cls).toBeLessThanOrEqual(0.1)
  expect(runtime.interaction).toBeLessThanOrEqual(200)
  expect(median('frameGapP95')).toBeLessThanOrEqual(50)
  expect(median('longTaskMax')).toBeLessThanOrEqual(100)
  expect(median('longTaskP95')).toBeLessThanOrEqual(50)
})
