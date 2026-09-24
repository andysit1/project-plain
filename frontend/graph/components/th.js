// Builds CallEdge Drawables from a graph's CodeEdges.
// Assigns a "lane" (+1 / -1) to each edge of a bidirectional pair (A->B and
// B->A) so they draw as two parallel, non-overlapping lines; unidirectional
// edges get lane 0. Edges whose ends don't currently resolve, or that are
// self-edges, are skipped without throwing.

import { edgeId } from '../../../shared/contracts.js'
import { CallEdge } from './transition.js'

/**
 * @param {{id:string, from:string, to:string, kind:'call'}[]} codeEdges
 * @param {(id: string) => ({x:number,y:number,w:number,h:number}|undefined)} boxOf
 * @returns {CallEdge[]}
 */
export function buildEdges(codeEdges, boxOf) {
  const result = []
  if (!Array.isArray(codeEdges)) return result

  const ids = new Set(codeEdges.map(e => e && e.id))

  for (const e of codeEdges) {
    if (!e || e.from === e.to) continue
    if (!boxOf(e.from) || !boxOf(e.to)) continue

    const hasReverse = ids.has(edgeId(e.to, e.from))
    // Consistent side per pair regardless of which direction we visit first.
    const lane = hasReverse ? (e.from < e.to ? 1 : -1) : 0

    result.push(new CallEdge(e, boxOf, { lane }))
  }

  return result
}
