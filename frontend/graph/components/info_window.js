// Inspector panel + status bar rendering. Pure DOM writer: takes a `doc` (document-like) so it
// can be exercised with a stub in tests. May import ONLY shared/contracts.js (see shared/dom.md).

/**
 * Fills #inspector for the selected node, or hides it when `node` is null.
 *
 * `node` is a drawable (e.g. a CodeNode instance) with `.id` and `.data` (a SceneNode: name,
 * qname, file, line, params, returns, ...).
 *
 * `graph` supplies what the inspector needs to list callers/callees and to let the user click
 * into one of them:
 *   - `graph.nodes`: SceneNode[] (or CodeNode[]), used to label the other end of each edge by qname.
 *   - `graph.edges`: { from, to }[], used to find callers (edges.to === node.id) and
 *     callees (edges.from === node.id).
 *   - `graph.select(id)`: called when a caller/callee `li` is clicked.
 */
export function renderInspector(doc, node, graph) {
  const inspector = doc.getElementById('inspector')
  if (!node) {
    if (inspector) inspector.hidden = true
    return
  }

  const data = node.data || node
  setText(doc, 'inspector-name', data.name ?? '')
  setText(doc, 'inspector-sig', signature(data))
  setText(doc, 'inspector-loc', `${data.file}:${data.line}`)

  const nodesById = new Map((graph?.nodes || []).map(n => [n.id, n]))
  const edges = graph?.edges || []
  const callers = edges.filter(e => e.to === node.id).map(e => e.from)
  const callees = edges.filter(e => e.from === node.id).map(e => e.to)

  fillList(doc, 'inspector-callers', callers, nodesById, graph)
  fillList(doc, 'inspector-callees', callees, nodesById, graph)

  const openBtn = doc.getElementById('open-in-editor')
  if (openBtn) {
    openBtn.onclick = () => {
      const f = encodeURIComponent(data.file)
      fetch(`/open?file=${f}&line=${data.line}`, { method: 'POST' })
    }
  }

  if (inspector) inspector.hidden = false
}

function signature(data) {
  const params = data.params ?? ''
  const returns = data.returns
  return returns ? `${data.name}(${params}) -> ${returns}` : `${data.name}(${params})`
}

function setText(doc, id, text) {
  const el = doc.getElementById(id)
  if (el) el.textContent = text
}

function fillList(doc, id, ids, nodesById, graph) {
  const ul = doc.getElementById(id)
  if (!ul) return
  if (typeof ul.replaceChildren === 'function') ul.replaceChildren()
  else ul.innerHTML = ''
  for (const otherId of ids) {
    const other = nodesById.get(otherId)
    const li = doc.createElement('li')
    li.textContent = other ? other.qname : otherId
    if (li.dataset) li.dataset.id = otherId
    else li.setAttribute?.('data-id', otherId)
    li.addEventListener('click', () => graph?.select?.(otherId))
    ul.appendChild(li)
  }
}

/**
 * Fills the status bar from `state`:
 *   state.connection: 'connecting' | 'open' | 'closed'
 *   state.scene: the latest Scene (after applyCeiling), or null before the first render
 *   state.rebuild: the latest StatusEvent ({ at, ms, ... }), or null
 */
export function renderStatus(doc, state) {
  const conn = doc.getElementById('status-conn')
  if (conn) {
    conn.textContent = state.connection
    if (conn.dataset) conn.dataset.state = state.connection
    else conn.setAttribute?.('data-state', state.connection)
  }

  const counts = doc.getElementById('status-counts')
  if (counts) {
    counts.textContent = state.scene ? countsText(state.scene) : ''
  }

  const rebuild = doc.getElementById('status-rebuild')
  if (rebuild) {
    rebuild.textContent = state.rebuild ? rebuildText(state.rebuild) : ''
  }

  const notice = doc.getElementById('files-mode-notice')
  if (notice) notice.hidden = !(state.scene && state.scene.mode === 'files')
}

function countsText(scene) {
  if (scene.mode === 'files') return `${scene.nodes.length} files · ${scene.total} functions`
  return `${scene.nodes.length} functions · ${scene.edges.length} calls`
}

function rebuildText(rebuild) {
  const d = new Date(rebuild.at)
  const pad = n => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `rebuilt ${time} (${rebuild.ms} ms)`
}
