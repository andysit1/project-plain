// Inspector panel + status bar rendering. Pure DOM writer: takes a `doc` (document-like) so it
// can be exercised with a stub in tests. May import ONLY shared/contracts.js (see shared/dom.md).

/**
 * Fills #inspector for the selected node, or hides it when `node` is null.
 *
 * Class boxes (L1: `data.classKind` is set) get the class view instead of callers/callees:
 * bases in the signature line, then fields (`name: type`), methods (click: graph.openMethod(id),
 * i.e. drill to that method in L2) and subclasses (click: graph.select(id)). The function-only
 * and class-only parts live in #inspector-fn / #inspector-cls; any missing element is skipped.
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
 *   - for class boxes: `graph.functions` (CodeNode[], to label methods) and `graph.openMethod(id)`.
 * Nodes without a file (L3 data drawables) show just their name.
 */
export function renderInspector(doc, node, graph) {
  const inspector = doc.getElementById('inspector')
  if (!node) {
    if (inspector) inspector.hidden = true
    return
  }

  const data = node.data || node
  const isClass = !!data.classKind
  setText(doc, 'inspector-name', data.name ?? node.id ?? '')
  setText(doc, 'inspector-sig', isClass ? classSignature(data) : (data.params !== undefined ? signature(data) : ''))
  setText(doc, 'inspector-loc', data.file ? `${data.file}:${data.line ?? 1}` : '')
  showSection(doc, 'inspector-fn', !isClass)
  showSection(doc, 'inspector-cls', isClass)

  if (isClass) renderClass(doc, node, data, graph)
  else renderCalls(doc, node, graph)

  const openBtn = doc.getElementById('open-in-editor')
  if (openBtn) {
    openBtn.hidden = !data.file
    openBtn.onclick = () => {
      const f = encodeURIComponent(data.file)
      fetch(`/open?file=${f}&line=${data.line}`, { method: 'POST' })
    }
  }

  if (inspector) inspector.hidden = false
}

function renderCalls(doc, node, graph) {
  const nodesById = new Map((graph?.nodes || []).map(n => [n.id, n]))
  const edges = graph?.edges || []
  const callers = edges.filter(e => e.to === node.id).map(e => e.from)
  const callees = edges.filter(e => e.from === node.id).map(e => e.to)

  fillList(doc, 'inspector-callers', callers, nodesById, graph)
  fillList(doc, 'inspector-callees', callees, nodesById, graph)
}

function renderClass(doc, node, data, graph) {
  const fields = data.classKind === 'module' ? [] : (data.fields || [])
  fillItems(doc, 'inspector-fields', fields.map(f => ({
    text: f.type ? `${f.name}: ${f.type}` : f.name,
  })))

  const fnById = new Map((graph?.functions || []).map(n => [n.id, n]))
  fillItems(doc, 'inspector-methods', (data.methods || []).map(id => ({
    id,
    text: fnById.get(id)?.name ?? id.slice(id.lastIndexOf('::') + 2),
    onClick: () => graph?.openMethod?.(id),
  })))

  const nodesById = new Map((graph?.nodes || []).map(n => [n.id, n]))
  const subs = (graph?.edges || []).filter(e => e.kind === 'inherits' && e.to === node.id).map(e => e.from)
  fillItems(doc, 'inspector-subclasses', subs.map(id => ({
    id,
    text: nodesById.get(id)?.name ?? id,
    onClick: () => graph?.select?.(id),
  })))

  const title = doc.getElementById('inspector-methods-title')
  if (title) title.textContent = data.classKind === 'module' ? 'Functions' : 'Methods'
}

function classSignature(data) {
  if (data.classKind === 'module') return `module ${data.file ?? data.name}`
  const bases = data.bases || []
  return bases.length ? `class ${data.name}(${bases.join(', ')})` : `class ${data.name}`
}

function showSection(doc, id, visible) {
  const el = doc.getElementById(id)
  if (el) el.hidden = !visible
}

// items: { text, id?, onClick? }[]; an empty list shows a dim "none" row.
function fillItems(doc, id, items) {
  const ul = doc.getElementById(id)
  if (!ul) return
  if (typeof ul.replaceChildren === 'function') ul.replaceChildren()
  else ul.innerHTML = ''
  if (!items.length) {
    const li = doc.createElement('li')
    li.textContent = 'none'
    if (li.classList) li.classList.add('empty')
    ul.appendChild(li)
    return
  }
  for (const it of items) {
    const li = doc.createElement('li')
    li.textContent = it.text
    if (it.id !== undefined) {
      if (li.dataset) li.dataset.id = it.id
      else li.setAttribute?.('data-id', it.id)
    }
    if (it.onClick) li.addEventListener('click', it.onClick)
    else if (li.classList) li.classList.add('static')
    ul.appendChild(li)
  }
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
  if (scene.mode === 'classes') return `${scene.nodes.length} classes · ${scene.edges.length} relations`
  if (scene.mode === 'data') return `${scene.nodes.length} shapes`
  return `${scene.nodes.length} functions · ${scene.edges.length} calls`
}

function rebuildText(rebuild) {
  const d = new Date(rebuild.at)
  const pad = n => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `rebuilt ${time} (${rebuild.ms} ms)`
}
