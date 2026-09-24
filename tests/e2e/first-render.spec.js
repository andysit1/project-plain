import { test, expect } from '@playwright/test'
import { copyDemoRepo, startMap, waitForRenders, cleanup } from './helpers/index.js'

test('first render shows the demo repo\'s 15 functions', async ({ page }) => {
  const repoDir = copyDemoRepo()
  const map = await startMap(repoDir)

  try {
    await page.goto(map.url)
    await waitForRenders(page, 1)

    const scene = await page.evaluate(() => window.__plain.scene)
    expect(scene, 'scene should be set after first render').toBeTruthy()
    expect(scene.nodes.length, 'node count after first render').toBe(15)

    await expect(page.locator('#status-conn')).toHaveText('open')
    await expect(page.locator('#status-counts')).toContainText('15')
  } finally {
    await map.stop()
    cleanup(repoDir)
    cleanup(map.dataDir)
  }
})
