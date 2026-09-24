// Canvas helpers for the L3 data-view render tests (@napi-rs/canvas). Node-only test helper.
// renderScene fits a { groups, edges, nodes } scene into a canvas the way graph.js draws it
// (dark background, world transform, groups -> edges -> nodes) and optionally saves a PNG.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'

const HERE = dirname(fileURLToPath(import.meta.url))
export const OUT_DIR = join(HERE, '..', '..', '..', 'test-results', 'l3')

/** Union of every drawable's bounds(). */
export function sceneBounds(scene) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const d of [...scene.groups, ...scene.edges, ...scene.nodes]) {
    const b = d.bounds()
    if (!b.w && !b.h) continue
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Draws the scene at 1:1 world scale (plus margin) and returns the canvas. */
export function renderScene(scene, { margin = 30, scale = 1, showLabels = true } = {}) {
  const b = sceneBounds(scene)
  const w = Math.ceil((b.w + margin * 2) * scale), h = Math.ceil((b.h + margin * 2) * scale)
  const canvas = createCanvas(Math.max(1, w), Math.max(1, h))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#121212'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(scale, 0, 0, scale, (margin - b.x) * scale, (margin - b.y) * scale)
  const view = { k: scale, showLabels }
  for (const list of [scene.groups, scene.edges, scene.nodes]) for (const d of list) d.draw(ctx, view)
  return canvas
}

/** Writes test-results/l3/<name>.png and returns its path. */
export function savePng(canvas, name) {
  mkdirSync(OUT_DIR, { recursive: true })
  const path = join(OUT_DIR, `${name}.png`)
  writeFileSync(path, canvas.toBuffer('image/png'))
  return path
}
