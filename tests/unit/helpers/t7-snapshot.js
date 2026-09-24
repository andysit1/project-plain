// Snapshot-compare helper for T7 canvas tests.
// Node-only (test helper, not shipped to the browser).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadImage, createCanvas } from '@napi-rs/canvas'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAP_DIR = join(HERE, '..', 'snapshots')

export function snapshotPath (name) {
  return join(SNAP_DIR, `t7-${name}.png`)
}

/**
 * Compares `canvas` against the stored snapshot `t7-<name>.png`.
 * With UPDATE_SNAPSHOTS=1, (re)writes the snapshot and returns { updated: true }.
 * Otherwise throws if the snapshot is missing, sized differently, or differs
 * beyond `tolerance` (max fraction of pixels allowed to differ by more than
 * `channelTolerance` in any channel).
 */
export async function compareSnapshot (canvas, name, { tolerance = 0.01, channelTolerance = 8 } = {}) {
  const path = snapshotPath(name)
  const buf = canvas.toBuffer('image/png')

  if (process.env.UPDATE_SNAPSHOTS === '1') {
    mkdirSync(SNAP_DIR, { recursive: true })
    writeFileSync(path, buf)
    return { updated: true }
  }

  if (!existsSync(path)) {
    throw new Error(`missing snapshot: ${path} (run with UPDATE_SNAPSHOTS=1 to create it)`)
  }

  const expectedImg = await loadImage(readFileSync(path))
  if (expectedImg.width !== canvas.width || expectedImg.height !== canvas.height) {
    throw new Error(
      `snapshot size mismatch for ${name}: expected ${expectedImg.width}x${expectedImg.height}, ` +
      `got ${canvas.width}x${canvas.height}`
    )
  }

  const expectedCanvas = createCanvas(canvas.width, canvas.height)
  const expectedCtx = expectedCanvas.getContext('2d')
  expectedCtx.drawImage(expectedImg, 0, 0)

  const actual = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  const expected = expectedCtx.getImageData(0, 0, canvas.width, canvas.height).data

  let diffPixels = 0
  const totalPixels = canvas.width * canvas.height
  for (let i = 0; i < actual.length; i += 4) {
    const dr = Math.abs(actual[i] - expected[i])
    const dg = Math.abs(actual[i + 1] - expected[i + 1])
    const db = Math.abs(actual[i + 2] - expected[i + 2])
    const da = Math.abs(actual[i + 3] - expected[i + 3])
    if (dr > channelTolerance || dg > channelTolerance || db > channelTolerance || da > channelTolerance) {
      diffPixels++
    }
  }

  const diffFraction = diffPixels / totalPixels
  if (diffFraction > tolerance) {
    throw new Error(
      `snapshot mismatch for ${name}: ${diffPixels}/${totalPixels} pixels differ ` +
      `(${(diffFraction * 100).toFixed(2)}%, tolerance ${(tolerance * 100).toFixed(2)}%)`
    )
  }

  return { updated: false, diffFraction }
}
