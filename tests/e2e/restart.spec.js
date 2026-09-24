import { test, expect } from '@playwright/test'
import { copyDemoRepo, startMap, waitForRenders, positions, cleanup } from './helpers/index.js'

test('restarting map with the same dataDir preserves every node position', async ({ page }) => {
  const repoDir = copyDemoRepo()
  let map = await startMap(repoDir)
  const dataDir = map.dataDir

  try {
    await page.goto(map.url)
    await waitForRenders(page, 1)

    const before = await positions(page)
    expect(Object.keys(before).length, 'nodes before restart').toBe(15)

    await map.stop()

    map = await startMap(repoDir, { dataDir })
    await page.goto(map.url)
    await waitForRenders(page, 1)

    const after = await positions(page)

    const beforeIds = Object.keys(before).sort()
    const afterIds = Object.keys(after).sort()
    expect(afterIds, 'node ids should be identical after restart').toEqual(beforeIds)

    const moved = beforeIds.filter(id => {
      const a = after[id]
      const b = before[id]
      return !a || a.x !== b.x || a.y !== b.y
    })
    expect(moved, 'nodes whose position changed after restart: ' + JSON.stringify(moved)).toEqual([])
  } finally {
    await map.stop()
    cleanup(repoDir)
    cleanup(dataDir)
  }
})
