'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Concept, ConceptConnection, ConceptType } from '@/lib/graph/types'
import AdminModuleNav from '@/components/navigation/AdminModuleNav'

type GraphSource = 'all' | 'curriculum' | 'student'

type WeekOption = { week_start: string; week_end: string }

type ConceptWithSchedule = Concept & {
  week_start: string | null
  week_end: string | null
  schedule_type: string | null
}

type GraphPayload = {
  concepts: ConceptWithSchedule[]
  connections: ConceptConnection[]
  options: {
    subjects: string[]
    grades: string[]
    weeks: WeekOption[]
  }
  stats: {
    totalConcepts: number
    totalConnections: number
    curriculumConnections: number
    studentConnections: number
    visibleSubjects: number
    trimmedConcepts: boolean
    trimmedConnections: boolean
  }
}

type RankedConcept = ConceptWithSchedule & { degree: number; key: string }

type ForceNode = {
  key: string
  label: string
  subject: string | null
  type: ConceptType
  x: number
  y: number
  radius: number
  degree: number
}

type GraphEdge = {
  id: string
  fromKey: string
  toKey: string
  relationship: string
  childKey: ConceptConnection['child_key']
}

type ForceGraphLayout = {
  nodes: ForceNode[]
  edges: GraphEdge[]
  width: number
  height: number
}

type GraphIndex = {
  conceptsByKey: Map<string, RankedConcept>
  outgoing: Map<string, GraphEdge[]>
  incoming: Map<string, GraphEdge[]>
}

type Viewport = { x: number; y: number; width: number; height: number }

// ── Subject palette ──────────────────────────────────────────────────────────

const SUBJECT_PALETTE: Record<string, string> = {
  Mathematics: '#4a90d9',
  Science: '#27ae85',
  History: '#e6a23c',
  Geography: '#9b6bff',
  'Language & Literature': '#e8577e',
  French: '#f59e0b',
  Spanish: '#f06543',
  Hindi: '#e05297',
  Telugu: '#c084fc',
  Design: '#06b6d4',
  Music: '#d97706',
  'Visual Arts': '#ec4899',
  PAHE: '#14b8a6',
}
const DEFAULT_COLOR = '#8b97a8'
const IB_KEY_COLOR = '#8b5cf6'

function subjectColor(subject: string | null, type: ConceptType): string {
  if (type === 'ib_key_concept') return IB_KEY_COLOR
  if (!subject) return DEFAULT_COLOR
  return SUBJECT_PALETTE[subject] ?? DEFAULT_COLOR
}

// ── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_EDGE_COLOR = '#4f7cff'
const MUTED_EDGE_COLOR = '#d0d5dd'
const DIMMED_NODE_OPACITY = 0.25
const MIN_RADIUS = 18
const MAX_RADIUS = 42
const CANVAS_PADDING = 60

// ── Helpers ──────────────────────────────────────────────────────────────────

function readText(res: Response) {
  return res.text()
}

function conceptKey(name: string, subject: string | null) {
  return `${name}::${subject ?? ''}`
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

function nodeRadius(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return MIN_RADIUS
  const t = Math.min(1, degree / Math.max(1, maxDegree * 0.5))
  return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS)
}

function degreeMapFromGraph(concepts: Concept[], connections: ConceptConnection[]) {
  const degreeMap = new Map<string, number>()
  for (const concept of concepts) {
    degreeMap.set(conceptKey(concept.name, concept.subject), 0)
  }
  for (const connection of connections) {
    const aKey = conceptKey(connection.concept_a, connection.subject_a)
    const bKey = conceptKey(connection.concept_b, connection.subject_b)
    degreeMap.set(aKey, (degreeMap.get(aKey) ?? 0) + 1)
    degreeMap.set(bKey, (degreeMap.get(bKey) ?? 0) + 1)
  }
  return degreeMap
}

function rankConcepts(concepts: ConceptWithSchedule[], connections: ConceptConnection[]): RankedConcept[] {
  const degreeMap = degreeMapFromGraph(concepts, connections)
  return concepts
    .map(concept => {
      const key = conceptKey(concept.name, concept.subject)
      return { ...concept, key, degree: degreeMap.get(key) ?? 0 }
    })
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))
}

// ── Graph index ──────────────────────────────────────────────────────────────

function buildGraphIndex(concepts: RankedConcept[], connections: ConceptConnection[]): GraphIndex {
  const conceptsByKey = new Map(concepts.map(c => [c.key, c] as const))
  const outgoing = new Map<string, GraphEdge[]>()
  const incoming = new Map<string, GraphEdge[]>()

  concepts.forEach(c => {
    outgoing.set(c.key, [])
    incoming.set(c.key, [])
  })

  const seen = new Set<string>()
  connections.forEach(conn => {
    const fromKey = conceptKey(conn.concept_a, conn.subject_a)
    const toKey = conceptKey(conn.concept_b, conn.subject_b)
    if (!conceptsByKey.has(fromKey) || !conceptsByKey.has(toKey)) return
    const uid = `${fromKey}|${toKey}|${conn.relationship}|${conn.child_key}|${conn.id}`
    if (seen.has(uid)) return
    seen.add(uid)
    const edge: GraphEdge = {
      id: conn.id,
      fromKey,
      toKey,
      relationship: conn.relationship,
      childKey: conn.child_key,
    }
    outgoing.get(fromKey)?.push(edge)
    incoming.get(toKey)?.push(edge)
  })

  return { conceptsByKey, outgoing, incoming }
}

function countAllDescendants(startKey: string, graphIndex: GraphIndex) {
  const visited = new Set<string>()
  const queue = [...(graphIndex.outgoing.get(startKey) ?? []).map(e => e.toKey)]
  while (queue.length) {
    const key = queue.shift()
    if (!key || key === startKey || visited.has(key)) continue
    visited.add(key)
    ;(graphIndex.outgoing.get(key) ?? []).forEach(e => {
      if (!visited.has(e.toKey) && e.toKey !== startKey) queue.push(e.toKey)
    })
  }
  return visited.size
}

// ── Force-directed layout ────────────────────────────────────────────────────

function buildForceGraph(concepts: RankedConcept[], graphIndex: GraphIndex): ForceGraphLayout {
  const all = Array.from(graphIndex.conceptsByKey.values())
  if (!all.length) return { nodes: [], edges: [], width: 800, height: 600 }

  const maxDegree = Math.max(...all.map(c => c.degree))
  const n = all.length

  const subjectGroups = new Map<string, number>()
  let groupIdx = 0
  all.forEach(c => {
    const s = c.subject ?? '_none'
    if (!subjectGroups.has(s)) subjectGroups.set(s, groupIdx++)
  })
  const totalGroups = subjectGroups.size

  const idealSpacing = Math.max(55, Math.min(90, 2400 / Math.sqrt(n)))
  const initRadius = Math.sqrt(n) * idealSpacing * 0.3

  const nodes: ForceNode[] = all.map(c => {
    const sg = subjectGroups.get(c.subject ?? '_none') ?? 0
    const groupAngle = (2 * Math.PI * sg) / totalGroups
    const groupR = initRadius * 0.6
    const cx = initRadius + Math.cos(groupAngle) * groupR
    const cy = initRadius + Math.sin(groupAngle) * groupR
    const jitter = 20 + Math.random() * 30
    const ja = Math.random() * 2 * Math.PI
    return {
      key: c.key,
      label: c.name,
      subject: c.subject,
      type: c.type,
      x: cx + Math.cos(ja) * jitter,
      y: cy + Math.sin(ja) * jitter,
      radius: nodeRadius(c.degree, maxDegree),
      degree: c.degree,
    }
  })

  const nodeIdx = new Map(nodes.map((nd, i) => [nd.key, i]))

  const allEdges: GraphEdge[] = []
  const edgeSeen = new Set<string>()
  all.forEach(c => {
    ;(graphIndex.outgoing.get(c.key) ?? []).forEach(e => {
      if (edgeSeen.has(e.id)) return
      if (!nodeIdx.has(e.toKey)) return
      edgeSeen.add(e.id)
      allEdges.push(e)
    })
  })

  const edgePairs = allEdges
    .map(e => ({ from: nodeIdx.get(e.fromKey)!, to: nodeIdx.get(e.toKey)! }))
    .filter(e => e.from !== undefined && e.to !== undefined)

  const repulsionCutoff = idealSpacing * 4
  const iterations = 80
  let temp = idealSpacing * 2
  const cooling = 0.94
  const gravityStrength = 0.06

  for (let iter = 0; iter < iterations; iter++) {
    const fx = new Float64Array(n)
    const fy = new Float64Array(n)

    // Grid-based neighbor lookup to avoid O(n²) for distant pairs
    const cellSize = repulsionCutoff
    const grid = new Map<string, number[]>()
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(nodes[i].x / cellSize)
      const gy = Math.floor(nodes[i].y / cellSize)
      const gk = `${gx},${gy}`
      if (!grid.has(gk)) grid.set(gk, [])
      grid.get(gk)!.push(i)
    }

    for (let i = 0; i < n; i++) {
      const gx = Math.floor(nodes[i].x / cellSize)
      const gy = Math.floor(nodes[i].y / cellSize)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const neighbors = grid.get(`${gx + ox},${gy + oy}`)
          if (!neighbors) continue
          for (const j of neighbors) {
            if (j <= i) continue
            const dx = nodes[i].x - nodes[j].x
            const dy = nodes[i].y - nodes[j].y
            const distSq = dx * dx + dy * dy
            if (distSq > repulsionCutoff * repulsionCutoff) continue
            const dist = Math.sqrt(distSq) || 0.5
            const force = (idealSpacing * idealSpacing) / dist
            const fdx = (dx / dist) * force
            const fdy = (dy / dist) * force
            fx[i] += fdx; fy[i] += fdy
            fx[j] -= fdx; fy[j] -= fdy
          }
        }
      }
    }

    for (const { from, to } of edgePairs) {
      const dx = nodes[to].x - nodes[from].x
      const dy = nodes[to].y - nodes[from].y
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.5
      const force = dist / idealSpacing
      const fdx = (dx / dist) * force
      const fdy = (dy / dist) * force
      fx[from] += fdx; fy[from] += fdy
      fx[to] -= fdx; fy[to] -= fdy
    }

    let avgX = 0, avgY = 0
    for (let i = 0; i < n; i++) { avgX += nodes[i].x; avgY += nodes[i].y }
    avgX /= n; avgY /= n
    for (let i = 0; i < n; i++) {
      fx[i] += (avgX - nodes[i].x) * gravityStrength
      fy[i] += (avgY - nodes[i].y) * gravityStrength
    }

    for (let i = 0; i < n; i++) {
      const dist = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]) || 0.1
      const cap = Math.min(dist, temp)
      nodes[i].x += (fx[i] / dist) * cap
      nodes[i].y += (fy[i] / dist) * cap
    }

    temp *= cooling
  }

  // Overlap removal pass
  for (let pass = 0; pass < 10; pass++) {
    let anyOverlap = false
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = nodes[j].x - nodes[i].x
        const dy = nodes[j].y - nodes[i].y
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.5
        const minDist = nodes[i].radius + nodes[j].radius + 6
        if (dist < minDist) {
          anyOverlap = true
          const push = (minDist - dist) / 2 + 1
          const nx = dx / dist
          const ny = dy / dist
          nodes[i].x -= nx * push; nodes[i].y -= ny * push
          nodes[j].x += nx * push; nodes[j].y += ny * push
        }
      }
    }
    if (!anyOverlap) break
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const nd of nodes) {
    minX = Math.min(minX, nd.x - nd.radius)
    minY = Math.min(minY, nd.y - nd.radius)
    maxX = Math.max(maxX, nd.x + nd.radius)
    maxY = Math.max(maxY, nd.y + nd.radius)
  }

  const width = Math.max(800, maxX - minX + CANVAS_PADDING * 2)
  const height = Math.max(600, maxY - minY + CANVAS_PADDING * 2)
  const offX = CANVAS_PADDING - minX
  const offY = CANVAS_PADDING - minY
  for (const nd of nodes) {
    nd.x += offX
    nd.y += offY
  }

  return { nodes, edges: allEdges, width, height }
}

// ── Edge path between circles ────────────────────────────────────────────────

function circleEdgePath(from: ForceNode, to: ForceNode): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = dx / dist
  const ny = dy / dist

  const x1 = from.x + nx * (from.radius + 2)
  const y1 = from.y + ny * (from.radius + 2)
  const x2 = to.x - nx * (to.radius + 6)
  const y2 = to.y - ny * (to.radius + 6)

  const perpScale = Math.min(18, dist * 0.06)
  const mx = (x1 + x2) / 2 + (-ny) * perpScale
  const my = (y1 + y2) / 2 + nx * perpScale

  return `M ${x1} ${y1} Q ${mx} ${my}, ${x2} ${y2}`
}

function edgeLabelPos(from: ForceNode, to: ForceNode) {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 8 }
}

// ── Viewport helpers ─────────────────────────────────────────────────────────

function fullViewport(layout: ForceGraphLayout): Viewport {
  return { x: 0, y: 0, width: layout.width, height: layout.height }
}

function clampViewport(next: Viewport, layout: ForceGraphLayout): Viewport {
  const minW = Math.max(200, layout.width * 0.08)
  const minH = Math.max(150, layout.height * 0.08)
  const w = Math.max(minW, Math.min(next.width, layout.width * 1.5))
  const h = Math.max(minH, Math.min(next.height, layout.height * 1.5))
  return {
    x: Math.max(-layout.width * 0.25, Math.min(next.x, layout.width - w * 0.5)),
    y: Math.max(-layout.height * 0.25, Math.min(next.y, layout.height - h * 0.5)),
    width: w,
    height: h,
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GraphAdminPage() {
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [search, setSearch] = useState('')
  const [browserQuery, setBrowserQuery] = useState('')
  const [source, setSource] = useState<GraphSource>('all')
  const [week, setWeek] = useState('')
  const [sortBy, setSortBy] = useState<'degree' | 'schedule'>('degree')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [graph, setGraph] = useState<GraphPayload | null>(null)
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)
  const [activeBranchNodeKey, setActiveBranchNodeKey] = useState<string | null>(null)
  const [draggedNodePositions, setDraggedNodePositions] = useState<Record<string, { x: number; y: number }>>({})
  const [showLabels, setShowLabels] = useState(false)
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null)
  const [editRelationship, setEditRelationship] = useState('')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragStateRef = useRef<{
    nodeKey: string
    pointerId: number
    startPointerX: number
    startPointerY: number
    startNodeX: number
    startNodeY: number
    moved: boolean
  } | null>(null)
  const panStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: Viewport
    moved: boolean
  } | null>(null)

  const loadGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (subject) params.set('subject', subject)
      if (grade) params.set('grade', grade)
      if (search.trim()) params.set('search', search.trim())
      if (source !== 'all') params.set('source', source)
      if (week) {
        const [ws, we] = week.split('|')
        if (ws) params.set('week_start', ws)
        if (we) params.set('week_end', we)
      }
      const suffix = params.toString() ? `?${params}` : ''
      const res = await fetch(`/api/admin/graph${suffix}`)
      const text = await readText(res)
      const payload = JSON.parse(text) as GraphPayload & { error?: string }
      if (!res.ok) throw new Error(payload.error || res.statusText)
      setGraph(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [grade, search, source, subject, week])

  useEffect(() => { void loadGraph() }, [loadGraph])

  const deleteConnection = useCallback(async (id: string) => {
    if (!confirm('Delete this connection?')) return
    try {
      const res = await fetch('/api/admin/graph/connections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Delete failed'); return }
      setGraph(prev => prev ? { ...prev, connections: prev.connections.filter(c => c.id !== id), stats: { ...prev.stats, totalConnections: prev.stats.totalConnections - 1 } } : prev)
    } catch (err) { alert(err instanceof Error ? err.message : 'Delete failed') }
  }, [])

  const updateConnection = useCallback(async (id: string, relationship: string) => {
    try {
      const res = await fetch('/api/admin/graph/connections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, relationship }),
      })
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Update failed'); return }
      setGraph(prev => prev ? { ...prev, connections: prev.connections.map(c => c.id === id ? { ...c, relationship } : c) } : prev)
      setEditingConnectionId(null)
    } catch (err) { alert(err instanceof Error ? err.message : 'Update failed') }
  }, [])

  const conceptRows = useMemo(() => graph ? rankConcepts(graph.concepts, graph.connections) : [], [graph])

  const filteredConceptRows = useMemo(() => {
    const q = browserQuery.trim().toLowerCase()
    let rows = conceptRows
    if (q) {
      rows = rows.filter(n => [n.name, n.subject ?? '', n.grade ?? '', n.type, n.week_start ?? ''].some(v => v.toLowerCase().includes(q)))
    }
    if (sortBy === 'schedule') {
      return [...rows].sort((a, b) => {
        const aDate = a.week_start ?? '9999'
        const bDate = b.week_start ?? '9999'
        return aDate.localeCompare(bDate) || a.name.localeCompare(b.name)
      })
    }
    return rows
  }, [browserQuery, conceptRows, sortBy])

  useEffect(() => {
    if (!conceptRows.length) { setSelectedNodeKey(null); setActiveBranchNodeKey(null); return }
    if (selectedNodeKey && !conceptRows.some(n => n.key === selectedNodeKey)) setSelectedNodeKey(null)
    if (activeBranchNodeKey && !conceptRows.some(n => n.key === activeBranchNodeKey)) setActiveBranchNodeKey(null)
  }, [activeBranchNodeKey, conceptRows, selectedNodeKey])

  const selectedNode = useMemo(() => selectedNodeKey ? conceptRows.find(n => n.key === selectedNodeKey) ?? null : null, [conceptRows, selectedNodeKey])

  const graphIndex = useMemo(() => buildGraphIndex(conceptRows, graph?.connections ?? []), [conceptRows, graph?.connections])

  const descendantCounts = useMemo(() => {
    const m = new Map<string, number>()
    conceptRows.forEach(n => m.set(n.key, countAllDescendants(n.key, graphIndex)))
    return m
  }, [conceptRows, graphIndex])

  const selectedConnections = useMemo(() => {
    if (!graph || !selectedNode) return []
    return graph.connections.filter(c => {
      const aK = conceptKey(c.concept_a, c.subject_a)
      const bK = conceptKey(c.concept_b, c.subject_b)
      return aK === selectedNode.key || bK === selectedNode.key
    })
  }, [graph, selectedNode])

  const forceLayout = useMemo(() => {
    if (!graph) return null
    return buildForceGraph(conceptRows, graphIndex)
  }, [conceptRows, graph, graphIndex])

  const renderedLayout = useMemo(() => {
    if (!forceLayout) return null
    return {
      ...forceLayout,
      nodes: forceLayout.nodes.map(nd => {
        const ov = draggedNodePositions[nd.key]
        return ov ? { ...nd, x: ov.x, y: ov.y } : nd
      }),
    }
  }, [draggedNodePositions, forceLayout])

  const nodeMap = useMemo(() => {
    if (!renderedLayout) return new Map<string, ForceNode>()
    return new Map(renderedLayout.nodes.map(n => [n.key, n]))
  }, [renderedLayout])

  const activeBranchEdgeIds = useMemo(() => {
    if (!renderedLayout || !activeBranchNodeKey) return new Set<string>()
    return new Set(
      renderedLayout.edges.filter(e => e.fromKey === activeBranchNodeKey || e.toKey === activeBranchNodeKey).map(e => e.id)
    )
  }, [activeBranchNodeKey, renderedLayout])

  const hasActiveBranch = activeBranchEdgeIds.size > 0

  const activeBranchNeighborKeys = useMemo(() => {
    if (!renderedLayout || !activeBranchNodeKey) return new Set<string>()
    const keys = new Set<string>()
    renderedLayout.edges.forEach(e => {
      if (e.fromKey === activeBranchNodeKey) keys.add(e.toKey)
      if (e.toKey === activeBranchNodeKey) keys.add(e.fromKey)
    })
    return keys
  }, [activeBranchNodeKey, renderedLayout])

  const fitViewToMap = useCallback(() => {
    if (!renderedLayout) return
    setViewport(fullViewport(renderedLayout))
  }, [renderedLayout])

  useEffect(() => {
    if (!renderedLayout) { setViewport(null); return }
    setViewport(fullViewport(renderedLayout))
  }, [renderedLayout])

  const zoomViewport = useCallback((factor: number, anchor?: { x: number; y: number }) => {
    if (!renderedLayout) return
    setViewport(current => {
      const base = current ?? fullViewport(renderedLayout)
      const nw = base.width / factor
      const nh = base.height / factor
      const t = anchor ?? { x: base.x + base.width / 2, y: base.y + base.height / 2 }
      const rx = base.width === 0 ? 0.5 : (t.x - base.x) / base.width
      const ry = base.height === 0 ? 0.5 : (t.y - base.y) / base.height
      return clampViewport({ x: t.x - nw * rx, y: t.y - nh * ry, width: nw, height: nh }, renderedLayout)
    })
  }, [renderedLayout])

  const centerOnNode = useCallback((key: string) => {
    if (!renderedLayout) return
    const nd = nodeMap.get(key)
    if (!nd) return
    setViewport(current => {
      const base = current ?? fullViewport(renderedLayout)
      const zoomW = Math.min(base.width, renderedLayout.width * 0.5)
      const zoomH = Math.min(base.height, renderedLayout.height * 0.5)
      return clampViewport({ x: nd.x - zoomW / 2, y: nd.y - zoomH / 2, width: zoomW, height: zoomH }, renderedLayout)
    })
  }, [nodeMap, renderedLayout])

  const pointerToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const vb = svg.viewBox.baseVal
    return {
      x: vb.x + ((clientX - rect.left) / rect.width) * vb.width,
      y: vb.y + ((clientY - rect.top) / rect.height) * vb.height,
    }
  }, [])

  const handleSvgPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget || !renderedLayout) return
    const current = viewport ?? fullViewport(renderedLayout)
    panStateRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: current, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [renderedLayout, viewport])

  const handleNodePointerDown = useCallback((event: React.PointerEvent<SVGGElement>, nd: ForceNode) => {
    event.stopPropagation()
    const point = pointerToSvg(event.clientX, event.clientY)
    const pos = draggedNodePositions[nd.key] ?? { x: nd.x, y: nd.y }
    dragStateRef.current = { nodeKey: nd.key, pointerId: event.pointerId, startPointerX: point.x, startPointerY: point.y, startNodeX: pos.x, startNodeY: pos.y, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [draggedNodePositions, pointerToSvg])

  const handleSvgPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (panStateRef.current && panStateRef.current.pointerId === event.pointerId && renderedLayout) {
      const pan = panStateRef.current
      const view = pan.origin
      const dx = ((event.clientX - pan.startX) / Math.max(1, event.currentTarget.clientWidth)) * view.width
      const dy = ((event.clientY - pan.startY) / Math.max(1, event.currentTarget.clientHeight)) * view.height
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true
      setViewport(clampViewport({ x: view.x - dx, y: view.y - dy, width: view.width, height: view.height }, renderedLayout))
      return
    }
    if (!renderedLayout || !dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) return
    const point = pointerToSvg(event.clientX, event.clientY)
    const drag = dragStateRef.current
    const nx = drag.startNodeX + (point.x - drag.startPointerX)
    const ny = drag.startNodeY + (point.y - drag.startPointerY)
    if (Math.abs(point.x - drag.startPointerX) > 3 || Math.abs(point.y - drag.startPointerY) > 3) drag.moved = true
    setDraggedNodePositions(prev => ({ ...prev, [drag.nodeKey]: { x: nx, y: ny } }))
  }, [pointerToSvg, renderedLayout])

  const handleSvgPointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (panStateRef.current && panStateRef.current.pointerId === event.pointerId) {
      const pan = panStateRef.current
      panStateRef.current = null
      if (!pan.moved) setActiveBranchNodeKey(null)
      return
    }
    if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) return
    const drag = dragStateRef.current
    dragStateRef.current = null
    if (!drag.moved) {
      setActiveBranchNodeKey(drag.nodeKey)
    }
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !renderedLayout) return

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const anchor = pointerToSvg(event.clientX, event.clientY)
      zoomViewport(event.deltaY < 0 ? 1.18 : 1 / 1.18, anchor)
    }

    // We need a non-passive listener because wheel zoom intentionally cancels page scroll.
    svg.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      svg.removeEventListener('wheel', handleWheel)
    }
  }, [pointerToSvg, renderedLayout, zoomViewport])

  const handleSvgKeyDown = useCallback((event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!renderedLayout) return

    const key = event.key
    if (key === '+' || key === '=' || key === 'NumpadAdd') {
      event.preventDefault()
      zoomViewport(1.3)
      return
    }
    if (key === '-' || key === '_' || key === 'NumpadSubtract') {
      event.preventDefault()
      zoomViewport(1 / 1.3)
      return
    }
    if (key === '0' || key === 'Numpad0') {
      event.preventDefault()
      fitViewToMap()
    }
  }, [fitViewToMap, renderedLayout, zoomViewport])

  const subjectCounts = useMemo(() => {
    if (!graph) return []
    const counts = new Map<string, number>()
    graph.concepts.forEach(c => {
      const k = c.subject ?? 'Uncategorized'
      counts.set(k, (counts.get(k) ?? 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [graph])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="graph-page">
      <AdminModuleNav />

      <h1>Knowledge graph explorer</h1>
      <p className="lead">
        View concepts and relationships stored in Supabase. Click any node to highlight its neighborhood.
      </p>

      <div className="card">
        <div className="graph-controls">
          <div>
            <label htmlFor="graph-subject">Subject</label>
            <select id="graph-subject" value={subject} onChange={e => setSubject(e.target.value)}>
              <option value="">All subjects</option>
              {graph?.options.subjects.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="graph-grade">Grade</label>
            <select id="graph-grade" value={grade} onChange={e => setGrade(e.target.value)}>
              <option value="">All grades</option>
              {graph?.options.grades.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="graph-source">Source</label>
            <select id="graph-source" value={source} onChange={e => setSource(e.target.value as GraphSource)}>
              <option value="all">All links</option>
              <option value="curriculum">Curriculum / WTR only</option>
              <option value="student">Student / session only</option>
            </select>
          </div>
          <div>
            <label htmlFor="graph-week">Week</label>
            <select id="graph-week" value={week} onChange={e => setWeek(e.target.value)}>
              <option value="">All weeks</option>
              {graph?.options.weeks?.map(w => {
                const label = `${w.week_start} → ${w.week_end}`
                return <option key={label} value={`${w.week_start}|${w.week_end}`}>{label}</option>
              })}
            </select>
          </div>
          <div>
            <label htmlFor="graph-search">Search</label>
            <input id="graph-search" type="text" placeholder="Quadratic, motion, IB, ..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="graph-controls-action">
            <button className="primary" type="button" onClick={() => void loadGraph()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh graph'}
            </button>
          </div>
        </div>
        {error && <p className="err" style={{ marginTop: '1rem' }}>{error}</p>}
      </div>

      {graph && (
        <>
          <div className="graph-stat-grid">
            <div className="card graph-stat-card">
              <div className="graph-stat-label">Nodes</div>
              <div className="graph-stat-value">{graph.stats.totalConcepts}</div>
            </div>
            <div className="card graph-stat-card">
              <div className="graph-stat-label">Edges</div>
              <div className="graph-stat-value">{graph.stats.totalConnections}</div>
            </div>
            <div className="card graph-stat-card">
              <div className="graph-stat-label">Curriculum</div>
              <div className="graph-stat-value">{graph.stats.curriculumConnections}</div>
            </div>
            <div className="card graph-stat-card">
              <div className="graph-stat-label">Student</div>
              <div className="graph-stat-value">{graph.stats.studentConnections}</div>
            </div>
          </div>

          <div className="graph-two-col">
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h2 className="graph-section-title" style={{ margin: 0 }}>Graph view</h2>
                <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.8rem', color: '#8ba0b8' }}>
                    <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
                    Edge labels
                  </label>
                  <button type="button" className="graph-action-btn" onClick={() => zoomViewport(1.3)}>+</button>
                  <button type="button" className="graph-action-btn" onClick={() => zoomViewport(1 / 1.3)}>-</button>
                  <button type="button" className="graph-action-btn" onClick={fitViewToMap}>Fit</button>
                </div>
              </div>

              <div className="graph-legend" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                {subjectCounts.slice(0, 14).map(([name]) => (
                  <span key={name} className="graph-legend-item" style={{ fontSize: '0.78rem' }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: SUBJECT_PALETTE[name] ?? DEFAULT_COLOR, marginRight: 4, verticalAlign: 'middle' }} />
                    {name}
                  </span>
                ))}
              </div>

              {!renderedLayout || renderedLayout.nodes.length === 0 ? (
                <p className="lead" style={{ margin: 0 }}>No graph data matches these filters yet.</p>
              ) : (
                <div className="graph-canvas-wrap graph-mindmap-wrap" style={{ background: '#0e1420', borderRadius: 12 }}>
                  <svg
                    ref={svgRef}
                    className="graph-canvas"
                    viewBox={`${(viewport ?? fullViewport(renderedLayout)).x} ${(viewport ?? fullViewport(renderedLayout)).y} ${(viewport ?? fullViewport(renderedLayout)).width} ${(viewport ?? fullViewport(renderedLayout)).height}`}
                    role="img"
                    aria-label="Knowledge graph"
                    tabIndex={0}
                    onPointerDown={handleSvgPointerDown}
                    onPointerMove={handleSvgPointerMove}
                    onPointerUp={handleSvgPointerUp}
                    onPointerCancel={handleSvgPointerUp}
                    onKeyDown={handleSvgKeyDown}
                    style={{ background: '#0e1420', cursor: 'grab' }}
                  >
                    <defs>
                      <marker id="ga-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={ACTIVE_EDGE_COLOR} />
                      </marker>
                      <marker id="ga-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={MUTED_EDGE_COLOR} fillOpacity="0.4" />
                      </marker>
                      <marker id="ga-default" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#8899aa" fillOpacity="0.6" />
                      </marker>
                      <filter id="glow-active" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="6" result="blur" />
                        <feFlood floodColor="#4f7cff" floodOpacity="0.6" result="color" />
                        <feComposite in="color" in2="blur" operator="in" result="shadow" />
                        <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                      <filter id="glow-node" x="-30%" y="-30%" width="160%" height="160%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feFlood floodColor="#ffffff" floodOpacity="0.12" result="color" />
                        <feComposite in="color" in2="blur" operator="in" result="shadow" />
                        <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                    </defs>

                    {renderedLayout.edges.map((edge, ei) => {
                      const from = nodeMap.get(edge.fromKey)
                      const to = nodeMap.get(edge.toKey)
                      if (!from || !to) return null
                      const active = hasActiveBranch && activeBranchEdgeIds.has(edge.id)
                      const stroke = hasActiveBranch
                        ? active ? ACTIVE_EDGE_COLOR : MUTED_EDGE_COLOR
                        : '#6b7f94'
                      const opacity = hasActiveBranch ? (active ? 0.95 : 0.08) : 0.35
                      const sw = active ? 2.5 : 1.2
                      const marker = hasActiveBranch ? (active ? 'url(#ga-active)' : 'url(#ga-muted)') : 'url(#ga-default)'

                      const showLabel = active || showLabels
                      const lp = edgeLabelPos(from, to)

                      return (
                        <g key={`${edge.id}:${ei}`}>
                          <path d={circleEdgePath(from, to)} fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth={sw} markerEnd={marker} />
                          {showLabel && (
                            <>
                              <rect
                                x={lp.x - edge.relationship.length * 3.2 - 6}
                                y={lp.y - 10}
                                width={Math.min(edge.relationship.length * 6.4 + 12, 160)}
                                height={16}
                                rx="4"
                                fill="#0e1420"
                                fillOpacity={active ? 0.85 : 0.7}
                              />
                              <text x={lp.x} y={lp.y + 1} textAnchor="middle" fill={active ? '#a0c4ff' : '#778899'} fontSize={active ? '9.5' : '8.5'} fontWeight={active ? '600' : '400'}>
                                {truncate(edge.relationship, 22)}
                              </text>
                            </>
                          )}
                        </g>
                      )
                    })}

                    {renderedLayout.nodes.map((nd, ni) => {
                      const isActive = nd.key === activeBranchNodeKey
                      const isNeighbor = activeBranchNeighborKeys.has(nd.key)
                      const isConnected = isActive || isNeighbor
                      const dimmed = hasActiveBranch && !isConnected
                      const fill = subjectColor(nd.subject, nd.type)
                      const desc = descendantCounts.get(nd.key) ?? 0

                      return (
                        <g
                          key={`${nd.key}:${ni}`}
                          onPointerDown={event => handleNodePointerDown(event, nd)}
                          style={{ cursor: 'pointer', opacity: dimmed ? DIMMED_NODE_OPACITY : 1 }}
                          filter={isActive ? 'url(#glow-active)' : isNeighbor ? 'url(#glow-node)' : undefined}
                        >
                          <circle
                            cx={nd.x}
                            cy={nd.y}
                            r={nd.radius}
                            fill={fill}
                            fillOpacity={isActive ? 1 : 0.92}
                            stroke={isActive ? '#ffffff' : isNeighbor ? ACTIVE_EDGE_COLOR : 'rgba(255,255,255,0.2)'}
                            strokeWidth={isActive ? 3 : isNeighbor ? 2.5 : 1.2}
                          />
                          <text
                            x={nd.x}
                            y={nd.y + nd.radius + 13}
                            textAnchor="middle"
                            fill={dimmed ? '#445566' : isActive ? '#ffffff' : '#b8c8d8'}
                            fontSize={isActive ? '11' : nd.radius >= 30 ? '11' : nd.radius >= 22 ? '9.5' : '8'}
                            fontWeight={isActive ? '700' : '500'}
                          >
                            {isActive ? nd.label : truncate(nd.label, nd.radius >= 30 ? 24 : nd.radius >= 22 ? 18 : 14)}
                          </text>
                          {isActive && desc > 0 && (
                            <text x={nd.x} y={nd.y + 5} textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="700">
                              {desc}
                            </text>
                          )}
                          <title>{`${nd.label}\n${nd.subject ?? 'Uncategorized'}\n${nd.degree} connections`}</title>
                        </g>
                      )
                    })}
                  </svg>
                </div>
              )}

              {activeBranchNodeKey && nodeMap.get(activeBranchNodeKey) && (
                <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.8rem', background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{nodeMap.get(activeBranchNodeKey)!.label}</div>
                  <div style={{ fontSize: '0.8rem', color: '#8ba0b8' }}>
                    {nodeMap.get(activeBranchNodeKey)!.subject ?? 'Uncategorized'} · {nodeMap.get(activeBranchNodeKey)!.degree} connections · {descendantCounts.get(activeBranchNodeKey) ?? 0} descendants
                  </div>
                </div>
              )}

              <div className="graph-relationship-panel">
                <h3 className="graph-section-title" style={{ marginTop: 0 }}>Relationship list</h3>
                {selectedConnections.length === 0 ? (
                  <p className="lead" style={{ margin: 0 }}>
                    {selectedNode ? 'No visible relationships for this concept under the current filters.' : 'Select a concept from the browser to inspect its relationships.'}
                  </p>
                ) : (
                  <div className="graph-connection-list">
                    {selectedConnections.slice(0, 30).map((connection, index) => (
                      <div key={`${connection.id}:${index}`} className="graph-connection-item">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                          <div className="graph-connection-source">{connection.child_key === 'curriculum' ? 'Curriculum' : 'Student'}</div>
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button type="button" className="graph-action-btn" title="Edit" onClick={() => { setEditingConnectionId(editingConnectionId === connection.id ? null : connection.id); setEditRelationship(connection.relationship) }}>✎</button>
                            <button type="button" className="graph-action-btn graph-action-btn-danger" title="Delete" onClick={() => void deleteConnection(connection.id)}>✕</button>
                          </div>
                        </div>
                        <div style={{ cursor: 'pointer' }} onClick={() => {
                          const otherKey = conceptKey(connection.concept_a, connection.subject_a) === selectedNodeKey ? conceptKey(connection.concept_b, connection.subject_b) : conceptKey(connection.concept_a, connection.subject_a)
                          setActiveBranchNodeKey(otherKey)
                          setSelectedNodeKey(otherKey)
                          centerOnNode(otherKey)
                        }}>
                          <strong>{connection.concept_a}</strong>{' '}
                          <span style={{ color: '#8ba0b8', fontStyle: 'italic' }}>{connection.relationship}</span>{' '}
                          <strong>{connection.concept_b}</strong>
                        </div>
                        {editingConnectionId === connection.id && (
                          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            <select value={editRelationship} onChange={e => setEditRelationship(e.target.value)} style={{ flex: 1, fontSize: '0.8rem', padding: '0.3rem 0.4rem', borderRadius: '6px', background: '#1a2030', color: '#e0e8f0', border: '1px solid var(--border)' }}>
                              {['prerequisite for','builds on','applies','extends','next in school syllabus','follows in schedule','real-world example of','same mathematical structure as','contrasts with','part of','relates to IB key concept','cross-subject link','concludes unit'].map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button type="button" className="graph-action-btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }} onClick={() => void updateConnection(connection.id, editRelationship)}>Save</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="graph-side-stack">
              <div className="card graph-browser-card">
                <div className="graph-browser-header">
                  <div>
                    <h2 className="graph-section-title" style={{ marginBottom: '0.35rem' }}>Concept browser</h2>
                    <p className="lead" style={{ margin: 0 }}>Jump to any concept in the graph.</p>
                  </div>
                  <div className="graph-browser-count">{filteredConceptRows.length} shown</div>
                </div>
                <div className="graph-browser-search" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label htmlFor="graph-browser-search">Quick find</label>
                    <input id="graph-browser-search" type="text" placeholder="Search by concept, subject, date..." value={browserQuery} onChange={e => setBrowserQuery(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="graph-sort">Sort</label>
                    <select id="graph-sort" value={sortBy} onChange={e => setSortBy(e.target.value as 'degree' | 'schedule')} style={{ minWidth: '6rem' }}>
                      <option value="degree">By links</option>
                      <option value="schedule">By date</option>
                    </select>
                  </div>
                </div>
                {selectedNode ? (
                  <div className="graph-browser-focus-wrap">
                    <button type="button" className="graph-browser-focus" onClick={() => { setActiveBranchNodeKey(selectedNode.key); centerOnNode(selectedNode.key) }}>
                      <span className="graph-browser-focus-label">Current focus</span>
                      <strong>{selectedNode.name}</strong>
                      <span className="graph-concept-meta">{selectedNode.subject ?? 'Uncategorized'} · {selectedNode.degree} links</span>
                    </button>
                    <button type="button" className="graph-browser-reset" onClick={() => { setActiveBranchNodeKey(null); setSelectedNodeKey(null); fitViewToMap() }}>
                      Back to full map
                    </button>
                  </div>
                ) : null}
                <div className="graph-concept-list">
                  {filteredConceptRows.length ? (
                    filteredConceptRows.map(node => (
                      <button key={node.key} type="button" className={`graph-concept-row ${selectedNodeKey === node.key ? 'graph-concept-row-active' : ''}`} onClick={() => { setActiveBranchNodeKey(node.key); setSelectedNodeKey(node.key); centerOnNode(node.key) }}>
                        <span>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: subjectColor(node.subject, node.type), marginRight: 6 }} />
                          <strong>{node.name}</strong>
                          <span className="graph-concept-meta">
                            {node.subject ?? 'Uncategorized'}
                            {node.week_start ? ` · ${node.week_start}` : ''}
                          </span>
                        </span>
                        <span className="graph-concept-degree">{node.degree}</span>
                      </button>
                    ))
                  ) : (
                    <div className="graph-empty-state">No concepts match this quick filter. Try a broader term.</div>
                  )}
                </div>
              </div>

              <div className="card">
                <h2 className="graph-section-title">Subjects in view</h2>
                <div className="graph-subject-list">
                  {subjectCounts.map(([value, count]) => (
                    <div key={value} className="graph-subject-row">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: SUBJECT_PALETTE[value] ?? DEFAULT_COLOR }} />
                        {value}
                      </span>
                      <span>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
