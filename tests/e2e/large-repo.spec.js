import { test, expect } from '@playwright/test'
import { copyDemoRepo, startMap, waitForRenders, cleanup } from './helpers/index.js'
import { makeLargeRepo } from './steps/index.js'

test('a repo over the node ceiling switches to files mode and stays responsive', async ({ page }) => {
  const repoDir = copyDemoRepo()
  makeLargeRepo(repoDir)
  const map = await startMap(repoDir, { timeoutMs: 60000 })

  try {
    await page.goto(map.url)
    await waitForRenders(page, 1, { timeout: 60000 })

    const mode = await page.evaluate(() => window.__plain.scene.mode)
    expect(mode, 'scene.mode should be "files" for the large fixture').toBe('files')

    await expect(page.locator('#files-mode-notice')).toBeVisible()

    const start = Date.now()
    const result = await page.evaluate(() => 1 + 1)
    const elapsed = Date.now() - start
    expect(result, 'page.evaluate round-trip should still work').toBe(2)
    expect(elapsed, `page.evaluate round-trip took ${elapsed}ms, page may be unresponsive`).toBeLessThan(2000)
  } finally {
    await map.stop()
    cleanup(repoDir)
    cleanup(map.dataDir)
  }
})
