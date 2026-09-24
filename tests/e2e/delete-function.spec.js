import { test, expect } from '@playwright/test'
import { copyDemoRepo, startMap, waitForRenders, positions, cleanup } from './helpers/index.js'
import { deleteFunction } from './steps/index.js'

test('deleting a function removes it and does not move any other node', async ({ page }) => {
  const repoDir = copyDemoRepo()
  const map = await startMap(repoDir)

  try {
    await page.goto(map.url)
    await waitForRenders(page, 1)

    const before = await positions(page)
    const removedId = 'app/db.py::close'
    expect(before[removedId], `node ${removedId} should exist before delete`).toBeTruthy()

    deleteFunction(repoDir)
    await waitForRenders(page, 2)

    const after = await positions(page)
    expect(after[removedId], `node ${removedId} should be gone after deleteFunction`).toBeUndefined()

    const remaining = Object.keys(before).filter(id => id !== removedId)
    const moved = remaining.filter(id => {
      const a = after[id]
      const b = before[id]
      return !a || a.x !== b.x || a.y !== b.y
    })
    expect(moved, 'nodes that moved after deleting close: ' + JSON.stringify(moved)).toEqual([])
  } finally {
    await map.stop()
    cleanup(repoDir)
    cleanup(map.dataDir)
  }
})
