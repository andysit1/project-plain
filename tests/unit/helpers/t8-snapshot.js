// Snapshot helpers for T8 (call edge) canvas tests, built on @napi-rs/canvas.
// Node-only (test helper), not part of the browser bundle.

import { createCanvas, loadImage } from '@napi-rs/canvas'

/** Renders `draw(ctx)` on a fresh w x h canvas and returns the PNG bytes. */
export function renderPng(w, h, draw) {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1e1e1e'
  ctx.fillRect(0, 0, w, h)
  draw(ctx)
  return canvas.toBuffer('image/png')
}

/** Decodes PNG bytes into raw RGBA pixel data via an offscreen canvas. */
async function decodePng(buf) {
  const img = await loadImage(buf)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, img.width, img.height)
}

/**
 * Compares two PNG buffers pixel by pixel (per-channel absolute difference).
 * Returns { equal, diffCount, maxDiff, totalPixels } — `equal` uses
 * `maxChannelDiff` per channel and `maxDiffRatio` of pixels allowed to differ.
 */
export async function comparePng(actualBuf, expectedBuf, { maxChannelDiff = 24, maxDiffRatio = 0.01 } = {}) {
  const a = await decodePng(actualBuf)
  const b = await decodePng(expectedBuf)
  if (a.width !== b.width || a.height !== b.height) {
    return { equal: false, diffCount: -1, maxDiff: -1, totalPixels: 0, reason: 'size mismatch' }
  }
  const totalPixels = a.width * a.height
  let diffCount = 0
  let maxDiff = 0
  for (let i = 0; i < a.data.length; i += 4) {
    let pixelDiff = 0
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c])
      if (d > pixelDiff) pixelDiff = d
    }
    if (pixelDiff > maxDiff) maxDiff = pixelDiff
    if (pixelDiff > maxChannelDiff) diffCount++
  }
  const equal = diffCount / totalPixels <= maxDiffRatio
  return { equal, diffCount, maxDiff, totalPixels }
}
