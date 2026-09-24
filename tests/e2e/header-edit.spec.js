import { test, expect } from '@playwright/test'
import { copyDemoRepo, startMap, waitForRenders, positions, cleanup } from './helpers/index.js'
import { editHeader } from './steps/index.js'

test('a header edit marks the node changed without moving it', async ({ page }) => {
  const repoDir = copyDemoRepo()
  const map = await startMap(repoDir)

  try {
    await page.goto(map.url)
    await waitForRenders(page, 1)

    const before = await positions(page)
    const nodeId = 'app/config.py::parse_env'
    expect(before[nodeId], `node ${nodeId} should exist before edit`).toBeTruthy()

    editHeader(repoDir)
    await waitForRenders(page, 2)

    const scene = await page.evaluate(() => window.__plain.scene)
    const node = scene.nodes.find(n => n.id === nodeId)
    expect(node, `node ${nodeId} should still exist in scene after header edit`).toBeTruthy()
    expect(node.changed, `node ${nodeId} should be marked changed: ${JSON.stringify(node)}`).toBe(true)

    const after = await positions(page)
    expect(after[nodeId], `node ${nodeId} should exist after edit`).toBeTruthy()
    expect(after[nodeId].x, 'x position unchanged after header edit').toBe(before[nodeId].x)
    expect(after[nodeId].y, 'y position unchanged after header edit').toBe(before[nodeId].y)
  } finally {
    await map.stop()
    cleanup(repoDir)
    cleanup(map.dataDir)
  }
})
