'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Concept, ConceptConnection, ConceptType } from '@/lib/graph/types'

type GraphSource = 'all' | 'curriculum' | 'student'

type GraphPayload = {
  concepts: Concept[]
  connections: ConceptConnection[]
  options: {
    subjects: string[]
    grades: string[]
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

type RankedConcept = Concept & {
  degree: number
  key: string
}

type MindMapNode = {
  key: string
  label: string
  subject: string | null
  type: ConceptType
  x: number
  y: number
  width: number
  height: number
  level: 'root' | 'backward' | 'forward' | 'forward-deep' | 'overview'
}

type MindMapEdge = {
  id: string
  fromKey: string
  toKey: string
  relationship: string
  childKey: ConceptConnection['child_key']
}

type MindMapHeader = {
  key: string
  label: string
  x: number
  y: number
}

type MindMapLane = {
  key: string
  label: string
  y: number
  height: number
}

type MindMapLayout = {
  nodes: MindMapNode[]
  edges: MindMapEdge[]
  width: number
  height: number
  mode: 'overview' | 'focus'
  headers?: MindMapHeader[]
  lanes?: MindMapLane[]
  showEdgeLabels?: boolean
}

type GraphIndex = {
  conceptsByKey: Map<string, RankedConcept>
  outgoing: Map<string, MindMapEdge[]>
  incoming: Map<string, MindMapEdge[]>
}

const ROOT_WIDTH = 300
const ROOT_HEIGHT = 72
const BRANCH_WIDTH = 220
const BRANCH_HEIGHT = 58
const DEEP_WIDTH = 230
const DEEP_HEIGHT = 54
const BACKWARD_X = 20
const ROOT_X = 340
const FORWARD_X = 760
const DEEP_X = 1100
const MINDMAP_WIDTH = 1420

function readText(res: Response) {
  return res.text()
}

function conceptKey(name: string, subject: string | null) {
  return `${name}::${subject ?? ''}`
}

function typeColor(type: ConceptType) {
  if (type === 'ib_key_concept') return '#8b5cf6'
  if (type === 'cross_subject') return '#f59e0b'
  return '#5b8fd8'
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
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

function arrangeVertical<T>(items: T[], centerY: number, gap: number) {
  if (items.length === 0) return []
  const totalHeight = (items.length - 1) * gap
  const start = centerY - totalHeight / 2
  return items.map((item, index) => ({ item, y: start + index * gap }))
}

function edgeAnchors(from: MindMapNode, to: MindMapNode) {
  const fromCenterX = from.x + from.width / 2
  const toCenterX = to.x + to.width / 2
  const goingRight = toCenterX >= fromCenterX
  const startX = goingRight ? from.x + from.width : from.x
  const endX = goingRight ? to.x : to.x + to.width
  const startY = from.y + from.height / 2
  const endY = to.y + to.height / 2
  return { goingRight, startX, endX, startY, endY }
}

function buildGraphIndex(concepts: RankedConcept[], connections: ConceptConnection[]): GraphIndex {
  const conceptsByKey = new Map(concepts.map(concept => [concept.key, concept] as const))
  const outgoing = new Map<string, MindMapEdge[]>()
  const incoming = new Map<string, MindMapEdge[]>()

  concepts.forEach(concept => {
    outgoing.set(concept.key, [])
    incoming.set(concept.key, [])
  })

  const edgeKeys = new Set<string>()
  connections.forEach(connection => {
    const fromKey = conceptKey(connection.concept_a, connection.subject_a)
    const toKey = conceptKey(connection.concept_b, connection.subject_b)
    if (!conceptsByKey.has(fromKey) || !conceptsByKey.has(toKey)) return
    const uniqueKey = `${fromKey}|${toKey}|${connection.relationship}|${connection.child_key}|${connection.id}`
    if (edgeKeys.has(uniqueKey)) return
    edgeKeys.add(uniqueKey)
    const edge: MindMapEdge = {
      id: connection.id,
      fromKey,
      toKey,
      relationship: connection.relationship,
      childKey: connection.child_key,
    }
    outgoing.get(fromKey)?.push(edge)
    incoming.get(toKey)?.push(edge)
  })

  return { conceptsByKey, outgoing, incoming }
}

function collapseExpandedBranch(
  key: string,
  expandedKeys: string[],
  graphIndex: GraphIndex,
  protectedKey: string | null
) {
  const expandedSet = new Set(expandedKeys)
  const toRemove = new Set<string>([key])
  const queue = [key]

  while (queue.length) {
    const current = queue.shift()
    if (!current) continue

    const neighbors = [
      ...(graphIndex.incoming.get(current) ?? []).map(edge => edge.fromKey),
      ...(graphIndex.outgoing.get(current) ?? []).map(edge => edge.toKey),
    ]

    neighbors.forEach(neighbor => {
      if (neighbor === protectedKey || !expandedSet.has(neighbor) || toRemove.has(neighbor)) return
      toRemove.add(neighbor)
      queue.push(neighbor)
    })
  }

  return expandedKeys.filter(expandedKey => !toRemove.has(expandedKey))
}

function countAllDescendants(startKey: string, graphIndex: GraphIndex) {
  const visited = new Set<string>()
  const queue = [...(graphIndex.outgoing.get(startKey) ?? []).map(edge => edge.toKey)]

  while (queue.length) {
    const key = queue.shift()
    if (!key || key === startKey || visited.has(key)) continue
    visited.add(key)
    ;(graphIndex.outgoing.get(key) ?? []).forEach(edge => {
      if (!visited.has(edge.toKey) && edge.toKey !== startKey) {
        queue.push(edge.toKey)
      }
    })
  }

  return visited.size
}

function buildMindMap(
  graphIndex: GraphIndex,
  rootKey: string | null,
  expandedKeys: Set<string>
): MindMapLayout | null {
  if (!rootKey) return null
  const root = graphIndex.conceptsByKey.get(rootKey)
  if (!root) return null

  const visibleKeys = new Set<string>([rootKey])
  const depthByKey = new Map<string, number>([[rootKey, 0]])

  const addNeighbor = (key: string, depth: number) => {
    if (!graphIndex.conceptsByKey.has(key) || visibleKeys.has(key)) return false
    visibleKeys.add(key)
    depthByKey.set(key, depth)
    return true
  }

  graphIndex.incoming.get(rootKey)?.forEach(edge => {
    addNeighbor(edge.fromKey, -1)
  })
  graphIndex.outgoing.get(rootKey)?.forEach(edge => {
    addNeighbor(edge.toKey, 1)
  })

  let changed = true
  while (changed) {
    changed = false
    expandedKeys.forEach(key => {
      if (!visibleKeys.has(key)) return
      const depth = depthByKey.get(key) ?? 0
      graphIndex.incoming.get(key)?.forEach(edge => {
        if (addNeighbor(edge.fromKey, depth - 1)) changed = true
      })
      graphIndex.outgoing.get(key)?.forEach(edge => {
        if (addNeighbor(edge.toKey, depth + 1)) changed = true
      })
    })
  }

  const edgeKeys = new Set<string>()
  const edges: MindMapEdge[] = []
  visibleKeys.forEach(key => {
    ;(graphIndex.outgoing.get(key) ?? []).forEach(edge => {
      if (!visibleKeys.has(edge.toKey)) return
      const uniqueKey = `${edge.fromKey}|${edge.toKey}|${edge.relationship}|${edge.childKey}|${edge.id}`
      if (edgeKeys.has(uniqueKey)) return
      edgeKeys.add(uniqueKey)
      edges.push(edge)
    })
  })

  const centerX = 620
  const centerY = 320
  const columnGap = 320
  const rowGap = 96
  const columns = new Map<number, RankedConcept[]>()

  Array.from(visibleKeys)
    .filter(key => key !== rootKey)
    .forEach(key => {
      const concept = graphIndex.conceptsByKey.get(key)
      if (!concept) return
      const depth = depthByKey.get(key) ?? 0
      if (!columns.has(depth)) columns.set(depth, [])
      columns.get(depth)?.push(concept)
    })

  columns.forEach(nodes => {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
  })

  const nodes: MindMapNode[] = [
    {
      key: root.key,
      label: root.name,
      subject: root.subject,
      type: root.type,
      x: centerX - ROOT_WIDTH / 2,
      y: centerY - ROOT_HEIGHT / 2,
      width: ROOT_WIDTH,
      height: ROOT_HEIGHT,
      level: 'root',
    },
  ]

  columns.forEach((columnNodes, depth) => {
    const slots = arrangeVertical(columnNodes, centerY, rowGap)
    slots.forEach(({ item, y }) => {
      nodes.push({
        key: item.key,
        label: item.name,
        subject: item.subject,
        type: item.type,
        x: centerX + depth * columnGap - BRANCH_WIDTH / 2,
        y: y - BRANCH_HEIGHT / 2,
        width: BRANCH_WIDTH,
        height: BRANCH_HEIGHT,
        level: depth < 0 ? 'backward' : 'forward',
      })
    })
  })

  const minX = Math.min(...nodes.map(node => node.x))
  const maxX = Math.max(...nodes.map(node => node.x + node.width))
  const minY = Math.min(...nodes.map(node => node.y))
  const maxY = Math.max(...nodes.map(node => node.y + node.height))
  const shiftX = minX < 24 ? 24 - minX : 0
  const shiftY = minY < 40 ? 40 - minY : 0

  if (shiftX || shiftY) {
    nodes.forEach(node => {
      node.x += shiftX
      node.y += shiftY
    })
  }

  return {
    nodes,
    edges,
    width: Math.max(MINDMAP_WIDTH, maxX - minX + 160),
    height: Math.max(680, maxY - minY + 180),
    mode: 'focus',
    showEdgeLabels: true,
  }
}

function buildOverviewMap(graphIndex: GraphIndex, expandedKeys: Set<string>): MindMapLayout | null {
  const rankedConcepts = Array.from(graphIndex.conceptsByKey.values()).sort(
    (a, b) => b.degree - a.degree || a.name.localeCompare(b.name)
  )
  if (!rankedConcepts.length) return null

  const indegree = new Map<string, number>(rankedConcepts.map(node => [node.key, 0]))
  rankedConcepts.forEach(node => {
    ;(graphIndex.outgoing.get(node.key) ?? []).forEach(edge => {
      indegree.set(edge.toKey, (indegree.get(edge.toKey) ?? 0) + 1)
    })
  })

  const queue = rankedConcepts
    .filter(node => (indegree.get(node.key) ?? 0) === 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(node => node.key)

  const levels = new Map<string, number>()
  while (queue.length) {
    const key = queue.shift()
    if (!key) continue
    const baseLevel = levels.get(key) ?? 0
    for (const edge of graphIndex.outgoing.get(key) ?? []) {
      levels.set(edge.toKey, Math.max(levels.get(edge.toKey) ?? 0, baseLevel + 1))
      indegree.set(edge.toKey, (indegree.get(edge.toKey) ?? 1) - 1)
      if ((indegree.get(edge.toKey) ?? 0) === 0) {
        queue.push(edge.toKey)
      }
    }
  }

  rankedConcepts.forEach(node => {
    if (levels.has(node.key)) return
    const incomingLevels = (graphIndex.incoming.get(node.key) ?? []).map(edge => levels.get(edge.fromKey) ?? -1)
    levels.set(node.key, Math.max(-1, ...incomingLevels) + 1)
  })

  const laneOf = (node: RankedConcept) =>
    node.type === 'cross_subject' || !node.subject ? 'Shared concepts' : node.subject

  const subjectOrder = Array.from(new Set(rankedConcepts.map(laneOf))).sort((a, b) => {
    if (a === 'Shared concepts') return -1
    if (b === 'Shared concepts') return 1
    return a.localeCompare(b)
  })

  const laneMap = new Map<string, RankedConcept[]>()
  subjectOrder.forEach(subject => laneMap.set(subject, []))
  rankedConcepts.forEach(node => {
    laneMap.get(laneOf(node))?.push(node)
  })

  const visibleKeys = new Set<string>()
  subjectOrder.forEach(subject => {
    const laneNodes = laneMap.get(subject) ?? []
    const minLevel = Math.min(...laneNodes.map(node => levels.get(node.key) ?? 0))
    laneNodes.forEach(node => {
      if ((levels.get(node.key) ?? 0) === minLevel) {
        visibleKeys.add(node.key)
      }
    })
  })

  let changed = true
  while (changed) {
    changed = false
    expandedKeys.forEach(key => {
      if (!visibleKeys.has(key)) return
      ;(graphIndex.outgoing.get(key) ?? []).forEach(edge => {
        if (!visibleKeys.has(edge.toKey)) {
          visibleKeys.add(edge.toKey)
          changed = true
        }
      })
    })
  }

  const edges: MindMapEdge[] = []
  const edgeKeys = new Set<string>()
  visibleKeys.forEach(key => {
    ;(graphIndex.outgoing.get(key) ?? []).forEach(edge => {
      if (!visibleKeys.has(edge.toKey)) return
      const uniqueKey = `${edge.fromKey}|${edge.toKey}|${edge.relationship}|${edge.childKey}|${edge.id}`
      if (edgeKeys.has(uniqueKey)) return
      edgeKeys.add(uniqueKey)
      edges.push(edge)
    })
  })

  const visibleIncomingCount = new Map<string, number>(Array.from(visibleKeys).map(key => [key, 0]))
  const visibleOutgoing = new Map<string, MindMapEdge[]>(Array.from(visibleKeys).map(key => [key, []]))
  const visibleIncoming = new Map<string, MindMapEdge[]>(Array.from(visibleKeys).map(key => [key, []]))
  edges.forEach(edge => {
    visibleIncomingCount.set(edge.toKey, (visibleIncomingCount.get(edge.toKey) ?? 0) + 1)
    visibleOutgoing.get(edge.fromKey)?.push(edge)
    visibleIncoming.get(edge.toKey)?.push(edge)
  })

  const displayQueue = Array.from(visibleKeys)
    .filter(key => (visibleIncomingCount.get(key) ?? 0) === 0)
    .sort((a, b) => {
      const conceptA = graphIndex.conceptsByKey.get(a)
      const conceptB = graphIndex.conceptsByKey.get(b)
      if (!conceptA || !conceptB) return a.localeCompare(b)
      const laneCompare = laneOf(conceptA).localeCompare(laneOf(conceptB))
      return laneCompare || conceptA.name.localeCompare(conceptB.name)
    })

  const displayLevels = new Map<string, number>()
  while (displayQueue.length) {
    const key = displayQueue.shift()
    if (!key) continue
    const baseLevel = displayLevels.get(key) ?? 0
    for (const edge of visibleOutgoing.get(key) ?? []) {
      displayLevels.set(edge.toKey, Math.max(displayLevels.get(edge.toKey) ?? 0, baseLevel + 1))
      visibleIncomingCount.set(edge.toKey, (visibleIncomingCount.get(edge.toKey) ?? 1) - 1)
      if ((visibleIncomingCount.get(edge.toKey) ?? 0) === 0) {
        displayQueue.push(edge.toKey)
      }
    }
  }

  Array.from(visibleKeys).forEach(key => {
    if (displayLevels.has(key)) return
    const inboundLevel = Math.max(-1, ...(visibleIncoming.get(key) ?? []).map(edge => displayLevels.get(edge.fromKey) ?? -1))
    displayLevels.set(key, inboundLevel + 1)
  })

  const visibleLevelValues = Array.from(visibleKeys).map(key => displayLevels.get(key) ?? 0)
  const minVisibleLevel = Math.min(...visibleLevelValues)
  const maxVisibleLevel = Math.max(...visibleLevelValues)
  const columnWidth = 236
  const columnGap = 124
  const rowGap = 84
  const laneGap = 44
  const laneHeaderHeight = 36
  const lanePadding = 18
  const marginX = 42
  const nodes: MindMapNode[] = []
  const lanes: MindMapLane[] = []
  let currentY = 24

  subjectOrder.forEach(subject => {
    const laneNodes = (laneMap.get(subject) ?? []).filter(node => visibleKeys.has(node.key))
    const columns = new Map<number, RankedConcept[]>()
    laneNodes.forEach(node => {
      const level = displayLevels.get(node.key) ?? 0
      if (!columns.has(level)) columns.set(level, [])
      columns.get(level)?.push(node)
    })

    const orderedLevels = Array.from(columns.keys()).sort((a, b) => a - b)
    const relativeY = new Map<string, number>()

    orderedLevels.forEach((level, levelIndex) => {
      const columnNodes = [...(columns.get(level) ?? [])]
      if (levelIndex === 0) {
        columnNodes.sort((a, b) => a.name.localeCompare(b.name))
        columnNodes.forEach((node, index) => {
          relativeY.set(node.key, index * rowGap)
        })
        return
      }

      columnNodes.sort((a, b) => {
        const parentsA = (visibleIncoming.get(a.key) ?? [])
          .map(edge => relativeY.get(edge.fromKey))
          .filter((value): value is number => value !== undefined)
        const parentsB = (visibleIncoming.get(b.key) ?? [])
          .map(edge => relativeY.get(edge.fromKey))
          .filter((value): value is number => value !== undefined)
        const avgA =
          parentsA.length > 0 ? parentsA.reduce((sum, value) => sum + value, 0) / parentsA.length : Number.MAX_SAFE_INTEGER
        const avgB =
          parentsB.length > 0 ? parentsB.reduce((sum, value) => sum + value, 0) / parentsB.length : Number.MAX_SAFE_INTEGER
        return avgA - avgB || a.name.localeCompare(b.name)
      })

      const groups = new Map<string, RankedConcept[]>()
      columnNodes.forEach(node => {
        const parentKeys = (visibleIncoming.get(node.key) ?? [])
          .map(edge => edge.fromKey)
          .sort()
        const groupKey = parentKeys.join('|') || node.key
        if (!groups.has(groupKey)) groups.set(groupKey, [])
        groups.get(groupKey)?.push(node)
      })

      const occupied: number[] = []
      Array.from(groups.values()).forEach(groupNodes => {
        const parentTargets = groupNodes
          .flatMap(node => (visibleIncoming.get(node.key) ?? []).map(edge => relativeY.get(edge.fromKey)))
          .filter((value): value is number => value !== undefined)

        const centerY =
          parentTargets.length > 0
            ? parentTargets.reduce((sum, value) => sum + value, 0) / parentTargets.length
            : occupied.length * rowGap

        const startY = centerY - ((groupNodes.length - 1) * rowGap) / 2
        groupNodes.forEach((node, index) => {
          let candidateY = startY + index * rowGap
          while (occupied.some(value => Math.abs(value - candidateY) < rowGap * 0.9)) {
            candidateY += rowGap
          }
          relativeY.set(node.key, candidateY)
          occupied.push(candidateY)
        })
      })
    })

    const maxRelativeY = Math.max(0, ...laneNodes.map(node => relativeY.get(node.key) ?? 0))
    const laneHeight = laneHeaderHeight + lanePadding * 2 + Math.max(56, maxRelativeY + 56)
    const laneNodeTop = currentY + laneHeaderHeight + lanePadding

    lanes.push({
      key: subject,
      label: subject,
      y: currentY,
      height: laneHeight,
    })

    orderedLevels.forEach(level => {
      const columnNodes = columns.get(level) ?? []
      columnNodes.forEach((node, index) => {
        nodes.push({
          key: node.key,
          label: node.name,
          subject: node.subject,
          type: node.type,
          x: marginX + (level - minVisibleLevel) * (columnWidth + columnGap),
          y: laneNodeTop + (relativeY.get(node.key) ?? index * rowGap),
          width: columnWidth,
          height: 56,
          level: 'overview',
        })
      })
    })

    currentY += laneHeight + laneGap
  })

  return {
    nodes,
    edges,
    width: Math.max(1080, marginX * 2 + (maxVisibleLevel - minVisibleLevel + 1) * columnWidth + (maxVisibleLevel - minVisibleLevel) * columnGap),
    height: Math.max(720, currentY - laneGap + 36),
    mode: 'overview',
    lanes,
    showEdgeLabels: edges.length <= 10,
  }
}

function edgePath(from: MindMapNode, to: MindMapNode) {
  const { goingRight, startX, endX, startY, endY } = edgeAnchors(from, to)
  const delta = Math.max(40, Math.abs(endX - startX) / 2)
  const controlA = startX + (goingRight ? delta : -delta)
  const controlB = endX - (goingRight ? delta : -delta)
  return `M ${startX} ${startY} C ${controlA} ${startY}, ${controlB} ${endY}, ${endX} ${endY}`
}

function edgeLabelPosition(from: MindMapNode, to: MindMapNode) {
  const { startX, endX, startY, endY } = edgeAnchors(from, to)
  const x = (startX + endX) / 2
  const y = (startY + endY) / 2
  return { x, y }
}

function wrapEdgeLabel(relationship: string, maxCharsPerLine = 18) {
  const words = relationship.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ['']

  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if (word.length > maxCharsPerLine) {
      if (currentLine) {
        lines.push(currentLine)
        currentLine = ''
      }
      for (let index = 0; index < word.length; index += maxCharsPerLine) {
        lines.push(word.slice(index, index + maxCharsPerLine))
      }
      continue
    }

    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (candidate.length <= maxCharsPerLine) {
      currentLine = candidate
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  }

  if (currentLine) lines.push(currentLine)
  return lines
}

function edgeLabelLayout(from: MindMapNode, to: MindMapNode, relationship: string) {
  const { x, y } = edgeLabelPosition(from, to)
  const lines = wrapEdgeLabel(relationship)
  const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const width = Math.max(88, longestLine * 6.4 + 22)
  const lineHeight = 12
  const height = lines.length * lineHeight + 10
  return { x, y: y - 16, width, height, lines, lineHeight }
}

function nodeFill(level: MindMapNode['level']) {
  if (level === 'root') return '#d6d0ff'
  if (level === 'forward-deep') return '#c7f1e8'
  if (level === 'backward') return '#f5e8cb'
  if (level === 'overview') return '#f6f8fc'
  return '#d9e8ff'
}

function nodeStroke(level: MindMapNode['level']) {
  if (level === 'root') return '#9d91ff'
  if (level === 'forward-deep') return '#7cd4c1'
  if (level === 'backward') return '#e0bd72'
  if (level === 'overview') return '#c8d2e0'
  return '#89b7ef'
}

function textColor(level: MindMapNode['level']) {
  if (level === 'root') return '#2b245f'
  if (level === 'overview') return '#213141'
  return '#173046'
}

function relationshipColor(childKey: ConceptConnection['child_key']) {
  return childKey === 'curriculum' ? '#5b8fd8' : '#3ecf8e'
}

function summarizeMindMap(map: { nodes: MindMapNode[] }) {
  return {
    prerequisites: map.nodes.filter(node => node.level === 'backward').length,
    nextIdeas: map.nodes.filter(node => node.level === 'forward').length,
    deeperIdeas: map.nodes.filter(node => node.level === 'forward-deep').length,
  }
}

function rankConcepts(concepts: Concept[], connections: ConceptConnection[]): RankedConcept[] {
  const degreeMap = degreeMapFromGraph(concepts, connections)
  return concepts
    .map(concept => {
      const key = conceptKey(concept.name, concept.subject)
      return {
        ...concept,
        key,
        degree: degreeMap.get(key) ?? 0,
      }
    })
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))
}

export default function GraphAdminPage() {
  const [adminSecret, setAdminSecret] = useState('')
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [search, setSearch] = useState('')
  const [browserQuery, setBrowserQuery] = useState('')
  const [source, setSource] = useState<GraphSource>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [graph, setGraph] = useState<GraphPayload | null>(null)
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)
  const [expandedNodeKeys, setExpandedNodeKeys] = useState<string[]>([])
  const [draggedNodePositions, setDraggedNodePositions] = useState<Record<string, { x: number; y: number }>>({})
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

  const headers = useCallback((): Record<string, string> => {
    const value = adminSecret.trim()
    const result: Record<string, string> = {}
    if (value) result['x-admin-secret'] = value
    return result
  }, [adminSecret])

  const loadGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (subject) params.set('subject', subject)
      if (grade) params.set('grade', grade)
      if (search.trim()) params.set('search', search.trim())
      if (source !== 'all') params.set('source', source)

      const suffix = params.toString() ? `?${params.toString()}` : ''
      const res = await fetch(`/api/admin/graph${suffix}`, { headers: headers() })
      const text = await readText(res)
      const payload = JSON.parse(text) as GraphPayload & { error?: string }
      if (!res.ok) {
        throw new Error(payload.error || res.statusText)
      }
      setGraph(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [grade, headers, search, source, subject])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph])

  const conceptRows = useMemo(() => {
    if (!graph) return []
    return rankConcepts(graph.concepts, graph.connections)
  }, [graph])

  const filteredConceptRows = useMemo(() => {
    const query = browserQuery.trim().toLowerCase()
    if (!query) return conceptRows
    return conceptRows.filter(node => {
      return [
        node.name,
        node.subject ?? '',
        node.grade ?? '',
        node.type,
      ].some(value => value.toLowerCase().includes(query))
    })
  }, [browserQuery, conceptRows])

  useEffect(() => {
    if (!conceptRows.length) {
      setSelectedNodeKey(null)
      return
    }
    const exists = selectedNodeKey && conceptRows.some(node => node.key === selectedNodeKey)
    if (selectedNodeKey && !exists) {
      setSelectedNodeKey(null)
    }
  }, [conceptRows, selectedNodeKey])

  const selectedNode = useMemo(() => {
    if (!selectedNodeKey) return null
    return conceptRows.find(node => node.key === selectedNodeKey) ?? null
  }, [conceptRows, selectedNodeKey])

  const graphIndex = useMemo(() => {
    return buildGraphIndex(conceptRows, graph?.connections ?? [])
  }, [conceptRows, graph?.connections])

  const descendantCounts = useMemo(() => {
    const result = new Map<string, number>()
    conceptRows.forEach(node => {
      result.set(node.key, countAllDescendants(node.key, graphIndex))
    })
    return result
  }, [conceptRows, graphIndex])

  const selectedConnections = useMemo(() => {
    if (!graph || !selectedNode) return []
    return graph.connections.filter(connection => {
      const aKey = conceptKey(connection.concept_a, connection.subject_a)
      const bKey = conceptKey(connection.concept_b, connection.subject_b)
      return aKey === selectedNode.key || bKey === selectedNode.key
    })
  }, [graph, selectedNode])

  useEffect(() => {
    setExpandedNodeKeys([])
    setDraggedNodePositions({})
  }, [graph, selectedNodeKey])

  const mindMap = useMemo(() => {
    if (!graph) return null
    const expanded = new Set(expandedNodeKeys)
    return selectedNode ? buildMindMap(graphIndex, selectedNode.key, expanded) : buildOverviewMap(graphIndex, expanded)
  }, [expandedNodeKeys, graph, graphIndex, selectedNode])

  const renderedMindMap = useMemo(() => {
    if (!mindMap) return null
    return {
      ...mindMap,
      nodes: mindMap.nodes.map(node => {
        const override = draggedNodePositions[node.key]
        return override ? { ...node, ...override } : node
      }),
    }
  }, [draggedNodePositions, mindMap])

  const mindMapSummary = useMemo(() => {
    if (!renderedMindMap || renderedMindMap.mode !== 'focus') return null
    return summarizeMindMap(renderedMindMap)
  }, [renderedMindMap])

  const toggleNodeExpansion = useCallback(
    (key: string) => {
      if (selectedNode && key === selectedNode.key) return
      setExpandedNodeKeys(prev => {
        if (!prev.includes(key)) return [...prev, key]
        return collapseExpandedBranch(key, prev, graphIndex, selectedNode?.key ?? null)
      })
    },
    [graphIndex, selectedNode]
  )

  const pointerToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const viewBox = svg.viewBox.baseVal
    return {
      x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.width,
      y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.height,
    }
  }, [])

  const handleNodePointerDown = useCallback(
    (event: React.PointerEvent<SVGGElement>, node: MindMapNode) => {
      const point = pointerToSvg(event.clientX, event.clientY)
      const currentPosition = draggedNodePositions[node.key] ?? { x: node.x, y: node.y }
      dragStateRef.current = {
        nodeKey: node.key,
        pointerId: event.pointerId,
        startPointerX: point.x,
        startPointerY: point.y,
        startNodeX: currentPosition.x,
        startNodeY: currentPosition.y,
        moved: false,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [draggedNodePositions, pointerToSvg]
  )

  const handleSvgPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!renderedMindMap || !dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) return
      const point = pointerToSvg(event.clientX, event.clientY)
      const drag = dragStateRef.current
      const nextX = drag.startNodeX + (point.x - drag.startPointerX)
      const nextY = drag.startNodeY + (point.y - drag.startPointerY)
      if (Math.abs(point.x - drag.startPointerX) > 3 || Math.abs(point.y - drag.startPointerY) > 3) {
        drag.moved = true
      }
      const activeNode = renderedMindMap.nodes.find(node => node.key === drag.nodeKey)
      if (!activeNode) return
      setDraggedNodePositions(prev => ({
        ...prev,
        [drag.nodeKey]: {
          x: Math.max(12, Math.min(nextX, renderedMindMap.width - activeNode.width - 12)),
          y: Math.max(12, Math.min(nextY, renderedMindMap.height - activeNode.height - 12)),
        },
      }))
    },
    [pointerToSvg, renderedMindMap]
  )

  const handleSvgPointerUp = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) return
      const drag = dragStateRef.current
      dragStateRef.current = null
      if (!drag.moved) {
        toggleNodeExpansion(drag.nodeKey)
      }
    },
    [toggleNodeExpansion]
  )

  const subjectCounts = useMemo(() => {
    if (!graph) return []
    const counts = new Map<string, number>()
    graph.concepts.forEach(concept => {
      const key = concept.subject ?? 'Uncategorized'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [graph])

  return (
    <main className="graph-page">
      <div className="admin-nav">
        <Link href="/">Home</Link>
        <Link href="/admin/wtr">WTR Upload</Link>
      </div>

      <h1>Knowledge graph explorer</h1>
      <p className="lead">
        View concepts and relationships already stored in Supabase. Curriculum links from WTR uploads are shown
        alongside student/session links so you can inspect how the map is evolving.
      </p>

      <div className="card">
        <div className="graph-controls">
          <div>
            <label htmlFor="secret">Admin secret (optional)</label>
            <input
              id="secret"
              type="password"
              autoComplete="off"
              placeholder="Only needed if WTR_ADMIN_SECRET is set"
              value={adminSecret}
              onChange={e => setAdminSecret(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="graph-subject">Subject</label>
            <select id="graph-subject" value={subject} onChange={e => setSubject(e.target.value)}>
              <option value="">All subjects</option>
              {graph?.options.subjects.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="graph-grade">Grade</label>
            <select id="graph-grade" value={grade} onChange={e => setGrade(e.target.value)}>
              <option value="">All grades</option>
              {graph?.options.grades.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
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
            <label htmlFor="graph-search">Search</label>
            <input
              id="graph-search"
              type="text"
              placeholder="Quadratic, motion, IB, ..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
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
              <div className="graph-stat-label">Concepts</div>
              <div className="graph-stat-value">{graph.stats.totalConcepts}</div>
            </div>
            <div className="card graph-stat-card">
              <div className="graph-stat-label">Connections</div>
              <div className="graph-stat-value">{graph.stats.totalConnections}</div>
            </div>
            <div className="card graph-stat-card">
              <div className="graph-stat-label">Curriculum links</div>
              <div className="graph-stat-value">{graph.stats.curriculumConnections}</div>
            </div>
            <div className="card graph-stat-card">
              <div className="graph-stat-label">Student links</div>
              <div className="graph-stat-value">{graph.stats.studentConnections}</div>
            </div>
          </div>

          <div className="graph-two-col">
            <div className="card">
              <h2 className="graph-section-title">Mind map view</h2>
              <p className="lead" style={{ marginBottom: '0.75rem' }}>
                {selectedNode
                  ? 'This view starts with the first layer around the focused concept. Click any visible node to reveal its next layer.'
                  : 'This overview starts with the first layer in each subject lane. Click any visible node to expand the next layer.'}
              </p>
              {selectedNode && mindMapSummary ? (
                <div className="graph-focus-banner">
                  <div>
                    <div className="graph-focus-label">Focused concept</div>
                    <div className="graph-focus-title">{selectedNode.name}</div>
                    <div className="graph-focus-meta">{selectedNode.subject ?? 'Uncategorized'}</div>
                  </div>
                  <div className="graph-focus-stats">
                    <span className="graph-focus-stat">
                      <strong>{mindMapSummary.prerequisites}</strong> prerequisites
                    </span>
                    <span className="graph-focus-stat">
                      <strong>{mindMapSummary.nextIdeas}</strong> next ideas
                    </span>
                    <span className="graph-focus-stat">
                      <strong>{mindMapSummary.deeperIdeas}</strong> deeper ideas
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="graph-toolbar">
                <div className="graph-mindmap-note">
                  {selectedNode
                    ? 'Drag nodes to reposition them. Use the concept browser to change the focus concept.'
                    : 'Each subject stays in one lane, shared concepts stay separate, and you can drag any visible node to reorganize the view.'}
                </div>
                <div className="graph-legend">
                  {selectedNode ? (
                    <>
                      <span className="graph-legend-item"><span className="graph-legend-box graph-legend-root" /> Focus concept</span>
                      <span className="graph-legend-item"><span className="graph-legend-box graph-legend-forward" /> Next ideas</span>
                      <span className="graph-legend-item"><span className="graph-legend-box graph-legend-deep" /> Deeper branch</span>
                      <span className="graph-legend-item"><span className="graph-legend-box graph-legend-backward" /> Prerequisite</span>
                    </>
                  ) : (
                    <span className="graph-legend-item"><span className="graph-legend-box graph-legend-overview" /> Visible concept</span>
                  )}
                  <span className="graph-legend-item"><span className="graph-legend-line graph-legend-curriculum" /> Curriculum</span>
                  <span className="graph-legend-item"><span className="graph-legend-line graph-legend-student" /> Student</span>
                </div>
              </div>
              {graph.stats.trimmedConcepts || graph.stats.trimmedConnections ? (
                <p className="lead" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  Large result set detected. The view is trimmed for readability; use filters to narrow it.
                </p>
              ) : null}
              {!renderedMindMap || renderedMindMap.nodes.length === 0 ? (
                <p className="lead" style={{ margin: 0 }}>
                  No graph data matches these filters yet.
                </p>
              ) : (
                <div className="graph-canvas-wrap graph-mindmap-wrap">
                  <svg
                    ref={svgRef}
                    className="graph-canvas"
                    viewBox={`0 0 ${renderedMindMap.width} ${renderedMindMap.height}`}
                    role="img"
                    aria-label="Knowledge mind map"
                    onPointerMove={handleSvgPointerMove}
                    onPointerUp={handleSvgPointerUp}
                    onPointerCancel={handleSvgPointerUp}
                  >
                    <defs>
                      <marker
                        id="graph-arrow-curriculum"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#3ecf8e" />
                      </marker>
                      <marker
                        id="graph-arrow-student"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#5b8fd8" />
                      </marker>
                    </defs>
                    {renderedMindMap.lanes?.map(lane => (
                      <g key={lane.key}>
                        <rect
                          x={12}
                          y={lane.y}
                          width={renderedMindMap.width - 24}
                          height={lane.height}
                          rx="16"
                          ry="16"
                          fill="rgba(246, 248, 252, 0.72)"
                          stroke="rgba(185, 198, 216, 0.7)"
                        />
                        <text
                          x={28}
                          y={lane.y + 24}
                          textAnchor="start"
                          fill="#506070"
                          fontSize="13"
                          fontWeight="700"
                        >
                          {lane.label}
                        </text>
                      </g>
                    ))}
                    {renderedMindMap.edges.map((edge, edgeIndex) => {
                      const from = renderedMindMap.nodes.find(node => node.key === edge.fromKey)
                      const to = renderedMindMap.nodes.find(node => node.key === edge.toKey)
                      if (!from || !to) return null
                      const label = edgeLabelLayout(from, to, edge.relationship)
                      const stroke = relationshipColor(edge.childKey)

                      return (
                        <g key={`${edge.id}:${edgeIndex}`}>
                          <path
                            d={edgePath(from, to)}
                            fill="none"
                            stroke={stroke}
                            strokeOpacity={renderedMindMap.mode === 'overview' ? '0.5' : '0.8'}
                            strokeWidth={2}
                            markerEnd={
                              renderedMindMap.mode === 'focus'
                                ? `url(#${edge.childKey === 'curriculum' ? 'graph-arrow-curriculum' : 'graph-arrow-student'})`
                                : undefined
                            }
                          />
                          {renderedMindMap.showEdgeLabels ? (
                            <>
                              <rect
                                x={label.x - label.width / 2}
                                y={label.y - label.height / 2}
                                rx="9"
                                ry="9"
                                width={label.width}
                                height={label.height}
                                fill="#ffffff"
                                fillOpacity="0.96"
                              />
                              <text
                                x={label.x}
                                y={label.y - ((label.lines.length - 1) * label.lineHeight) / 2 + 4}
                                textAnchor="middle"
                                fill="#506070"
                                fontSize="10.5"
                                fontWeight="600"
                              >
                                {label.lines.map((line, lineIndex) => (
                                  <tspan
                                    key={`${edge.id}:${lineIndex}`}
                                    x={label.x}
                                    dy={lineIndex === 0 ? 0 : label.lineHeight}
                                  >
                                    {line}
                                  </tspan>
                                ))}
                              </text>
                            </>
                          ) : null}
                        </g>
                      )
                    })}

                    {renderedMindMap.nodes.map((node, nodeIndex) => {
                      const selected = node.key === selectedNodeKey
                      const descendantCount = descendantCounts.get(node.key) ?? 0
                      return (
                        <g
                          key={`${node.key}:${node.level}:${nodeIndex}`}
                          onPointerDown={event => handleNodePointerDown(event, node)}
                          style={{ cursor: 'grab' }}
                        >
                          <rect
                            x={node.x}
                            y={node.y}
                            rx="12"
                            ry="12"
                            width={node.width}
                            height={node.height}
                            fill={nodeFill(node.level)}
                            stroke={selected ? '#253041' : node.level === 'overview' ? typeColor(node.type) : nodeStroke(node.level)}
                            strokeWidth={selected ? 2.5 : 1.3}
                          />
                          {descendantCount > 0 ? (
                            <>
                              <rect
                                x={node.x + node.width - 54}
                                y={node.y + 10}
                                rx="999"
                                ry="999"
                                width="42"
                                height="18"
                                fill="rgba(255,255,255,0.92)"
                                stroke="rgba(91, 143, 216, 0.55)"
                                strokeWidth="1"
                              />
                              <text
                                x={node.x + node.width - 33}
                                y={node.y + 23}
                                textAnchor="middle"
                                fill="#47627d"
                                fontSize="10"
                                fontWeight="700"
                              >
                                {descendantCount}
                              </text>
                            </>
                          ) : null}
                          <text
                            x={node.x + 12}
                            y={node.y + 24}
                            fill={textColor(node.level)}
                            fontSize="13"
                            fontWeight="600"
                          >
                            {truncate(node.label, node.level === 'root' ? 28 : 24)}
                          </text>
                          <text x={node.x + 12} y={node.y + 45} fill="#556474" fontSize="11">
                            {truncate(node.subject ?? 'Uncategorized', 25)}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                </div>
              )}

              <div className="graph-relationship-panel">
                <h3 className="graph-section-title" style={{ marginTop: 0 }}>
                  Relationship list
                </h3>
                {selectedConnections.length === 0 ? (
                  <p className="lead" style={{ margin: 0 }}>
                    {selectedNode
                      ? 'No visible relationships for this concept under the current filters.'
                      : 'Select a concept from the map or browser to inspect its relationships.'}
                  </p>
                ) : (
                  <div className="graph-connection-list">
                    {selectedConnections.slice(0, 24).map((connection, index) => (
                      <button
                        key={`${connection.id}:${index}`}
                        type="button"
                        className="graph-connection-item graph-connection-button"
                        onClick={() => setSelectedNodeKey(conceptKey(connection.concept_a, connection.subject_a))}
                      >
                        <div className="graph-connection-source">
                          {connection.child_key === 'curriculum' ? 'Curriculum' : 'Student'}
                        </div>
                        <div>
                          <strong>{connection.concept_a}</strong> {connection.relationship}{' '}
                          <strong>{connection.concept_b}</strong>
                        </div>
                      </button>
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
                    <p className="lead" style={{ margin: 0 }}>
                      Jump to any concept without leaving the map.
                    </p>
                  </div>
                  <div className="graph-browser-count">{filteredConceptRows.length} shown</div>
                </div>
                <div className="graph-browser-search">
                  <label htmlFor="graph-browser-search">Quick find</label>
                  <input
                    id="graph-browser-search"
                    type="text"
                    placeholder="Search by concept, subject, grade..."
                    value={browserQuery}
                    onChange={e => setBrowserQuery(e.target.value)}
                  />
                </div>
                {selectedNode ? (
                  <div className="graph-browser-focus-wrap">
                    <button
                      type="button"
                      className="graph-browser-focus"
                      onClick={() => setSelectedNodeKey(selectedNode.key)}
                    >
                      <span className="graph-browser-focus-label">Current focus</span>
                      <strong>{selectedNode.name}</strong>
                      <span className="graph-concept-meta">
                        {selectedNode.subject ?? 'Uncategorized'} · {selectedNode.degree} visible links
                      </span>
                    </button>
                    <button
                      type="button"
                      className="graph-browser-reset"
                      onClick={() => setSelectedNodeKey(null)}
                    >
                      Back to full map
                    </button>
                  </div>
                ) : null}
                <div className="graph-concept-list">
                  {filteredConceptRows.length ? (
                    filteredConceptRows.map(node => (
                      <button
                        key={node.key}
                        type="button"
                        className={`graph-concept-row ${selectedNodeKey === node.key ? 'graph-concept-row-active' : ''}`}
                        onClick={() => setSelectedNodeKey(node.key)}
                      >
                        <span>
                          <strong>{node.name}</strong>
                          <span className="graph-concept-meta">{node.subject ?? 'Uncategorized'}</span>
                        </span>
                        <span className="graph-concept-degree">{node.degree}</span>
                      </button>
                    ))
                  ) : (
                    <div className="graph-empty-state">
                      No concepts match this quick filter. Try a broader term.
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <h2 className="graph-section-title">Selected concept</h2>
                <p className="lead" style={{ marginBottom: '0.75rem' }}>
                  See the active node details and all visible relationships in one place.
                </p>
                {selectedNode ? (
                  <>
                    <div className="graph-node-chip-row">
                      <span className="graph-chip">{selectedNode.type}</span>
                      {selectedNode.grade ? <span className="graph-chip">{selectedNode.grade}</span> : null}
                    </div>
                    <h3 style={{ margin: '0 0 0.25rem' }}>{selectedNode.name}</h3>
                    <p className="lead" style={{ marginBottom: '0.75rem' }}>
                      {selectedNode.subject ?? 'Uncategorized'} · {selectedNode.degree} visible links
                    </p>
                    {selectedConnections.length === 0 ? (
                      <p className="lead" style={{ margin: 0 }}>
                        No visible connections for this concept under the current filters.
                      </p>
                    ) : (
                      <div className="graph-connection-list">
                        {selectedConnections.map((connection, index) => (
                          <div key={`${connection.id}:${index}`} className="graph-connection-item">
                            <div className="graph-connection-source">
                              {connection.child_key === 'curriculum' ? 'Curriculum' : 'Student'}
                            </div>
                            <div>
                              <strong>{connection.concept_a}</strong> {connection.relationship}{' '}
                              <strong>{connection.concept_b}</strong>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="lead" style={{ margin: 0 }}>
                    Click a node in the graph to inspect its local neighborhood.
                  </p>
                )}
              </div>

              <div className="card">
                <h2 className="graph-section-title">Subjects in view</h2>
                <div className="graph-subject-list">
                  {subjectCounts.map(([value, count]) => (
                    <div key={value} className="graph-subject-row">
                      <span>{value}</span>
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
