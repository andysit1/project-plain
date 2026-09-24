import { test, expect } from '@playwright/test'
import { NODE_W, NODE_H, NODE_GAP } from '../../shared/contracts.js'
import { copyDemoRepo, startMap, waitForRenders, positions, cleanup } from './helpers/index.js'
import { addFunction } from './steps/index.js'

test('adding a function places it next to its caller without moving anything else', async ({ page }) => {
  const repoDir = copyDemoRepo()
  const map = await startMap(repoDir)

  try {
    await page.goto(map.url)
    await waitForRenders(page, 1)

    const before = await positions(page)
    expect(Object.keys(before).length, 'nodes before edit').toBe(15)

    addFunction(repoDir)
    await waitForRenders(page, 2)

    const after = await positions(page)
    const newId = 'app/utils.py::chunk'
    expect(after[newId], `new node ${newId} should exist after addFunction: ${JSON.stringify(after)}`).toBeTruthy()

    const callerId = 'app/utils.py::read_file'
    const caller = after[callerId]
    expect(caller, `caller node ${callerId} should still exist`).toBeTruthy()

    const dx = Math.abs(after[newId].x - caller.x)
    const dy = Math.abs(after[newId].y - caller.y)
    const maxDx = 2 * (NODE_W + NODE_GAP)
    const maxDy = 2 * (NODE_H + NODE_GAP)
    expect(dx, `new node x distance from caller: ${dx} (max ${maxDx})`).toBeLessThanOrEqual(maxDx)
    expect(dy, `new node y distance from caller: ${dy} (max ${maxDy})`).toBeLessThanOrEqual(maxDy)

    const moved = Object.keys(before).filter(id => {
      const a = after[id]
      const b = before[id]
      return a && (a.x !== b.x || a.y !== b.y)
    })
    expect(moved, 'nodes that moved after addFunction: ' + JSON.stringify(moved)).toEqual([])
  } finally {
    await map.stop()
    cleanup(repoDir)
    cleanup(map.dataDir)
  }
})
