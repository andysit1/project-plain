// Geometry helpers for edge drawing: Liang-Barsky line clipping against a box,
// and perpendicular lane offsets so A->B and B->A draw as two parallel lines.
// Browser ES module: no Node APIs, only shared/contracts.js allowed as an import (none needed here).

/**
 * Clips the segment (x1,y1)-(x2,y2) to the border of the axis-aligned box
 * {x,y,w,h} using the Liang-Barsky algorithm.
 *
 * Returns the point on the segment where it crosses the box border, walking
 * in FROM (x1,y1) TOWARDS (x2,y2). This is the point closest to (x1,y1) that
 * still lies on the box's edge, i.e. the visible portion of the segment is
 * clipped away up to the border.
 *
 * If (x1,y1) is already outside the box the result may not be meaningful for
 * "clip an endpoint sitting inside the box" use cases; this helper is meant to
 * be called with one endpoint inside the box (a node's center) and the other
 * endpoint elsewhere, to find where the segment exits the box.
 *
 * @returns {{x:number,y:number}}
 */
export function liangBarskyClip(box, x1, y1, x2, y2) {
  const xmin = box.x, ymin = box.y, xmax = box.x + box.w, ymax = box.y + box.h

  const dx = x2 - x1
  const dy = y2 - y1

  // p/q pairs for each of the four box edges (left, right, bottom, top)
  const p = [-dx, dx, -dy, dy]
  const q = [x1 - xmin, xmax - x1, y1 - ymin, ymax - y1]

  let tMin = 0
  let tMax = 1

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      // Parallel to this boundary; if outside, there is no intersection on this side.
      if (q[i] < 0) {
        // Line is parallel and outside the box: fall back to the far endpoint.
        return { x: x2, y: y2 }
      }
      continue
    }
    const t = q[i] / p[i]
    if (p[i] < 0) {
      if (t > tMax) return { x: x2, y: y2 }
      if (t > tMin) tMin = t
    } else {
      if (t < tMin) return { x: x2, y: y2 }
      if (t < tMax) tMax = t
    }
  }

  return { x: x1 + tMin * dx, y: y1 + tMin * dy }
}

/**
 * Perpendicular unit vector to the direction from `a` to `b` (box centers),
 * with a stable fallback when the two points coincide.
 * @returns {{x:number,y:number}}
 */
export function perpendicular(ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const mag = Math.sqrt(dx * dx + dy * dy)
  if (mag === 0) return { x: 1, y: 0 }
  // Rotate the normalized direction vector by +90 degrees.
  return { x: -dy / mag, y: dx / mag }
}

/** Center point of a box {x,y,w,h}. */
export function boxCenter(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}
