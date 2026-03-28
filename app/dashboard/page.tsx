'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import DateRangePicker from '@/components/dashboard/DateRangePicker'
import {
  buildTopicSlots,
  getTimelineBounds,
  timelineDays,
  type Subject,
  type TopicSlot,
} from '@/lib/dashboard/timeline'

type TimelineResponse = {
  filters: {
    startDate: string
    endDate: string
    subjectId: string
    minDate: string
    maxDate: string
  }
  weeks: { week_start: string; week_end: string }[]
  subjects: Subject[]
  allSubjects: Subject[]
  topicSlots: TopicSlot[]
}

type ChainNode = {
  key: string
  name: string
  subject: string | null
  depth: number
  kind: 'focus' | 'upstream' | 'downstream'
}

type ChainEdge = {
  id: string
  fromKey: string
  toKey: string
  relationship: string
}

type TopicChainResponse = {
  topic: string
  subject: string | null
  focusKey: string
  nodes: ChainNode[]
  edges: ChainEdge[]
}

type LaidOutSlot = { slot: TopicSlot; lane: number }
type PositionedNode = ChainNode & { x: number; y: number }
type TopicRef = { title: string; subject: string | null }
type MapTopicTab = TopicRef & { id: string }
type EdgeRenderData = {
  edge: ChainEdge
  path: string
  label: string
  labelX: number
  labelY: number
  labelWidth: number
}

type TutorMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type TopicResource = {
  id: string
  topic_title: string
  topic_subject: string | null
  resource_type: 'file' | 'url' | 'note'
  label: string | null
  url: string | null
  file_name: string | null
  note_content?: string | null
  visibility?: 'own' | 'shared'
  open_url: string | null
  created_at: string
}

type ShareUser = {
  userId: string | null
  email: string
  displayName: string
  status?: 'registered' | 'you' | 'pending'
}

function conceptKey(name: string, subject: string | null) {
  return `${name}@@${subject ?? ''}`
}

function parseConceptKey(key: string) {
  const idx = key.lastIndexOf('@@')
  if (idx < 0) return { name: key, subject: null as string | null }
  const name = key.slice(0, idx)
  const subject = key.slice(idx + 2) || null
  return { name, subject }
}

function getSlotStyle(slot: TopicSlot) {
  const dayWidth = 100 / timelineDays.length
  const left = slot.startDay * dayWidth
  const width = (slot.endDay - slot.startDay + 1) * dayWidth
  return {
    left: `${left}%`,
    width: `${width}%`,
  }
}

function layoutSlotsIntoLanes(slots: TopicSlot[]): LaidOutSlot[] {
  const sorted = [...slots].sort((a, b) => {
    if (a.startDay !== b.startDay) return a.startDay - b.startDay
    if (a.endDay !== b.endDay) return a.endDay - b.endDay
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate)
    return a.title.localeCompare(b.title)
  })

  const laneEndDays: number[] = []
  const laidOut: LaidOutSlot[] = []

  sorted.forEach(slot => {
    let lane = laneEndDays.findIndex(lastEndDay => slot.startDay > lastEndDay)
    if (lane === -1) {
      lane = laneEndDays.length
      laneEndDays.push(slot.endDay)
    } else {
      laneEndDays[lane] = slot.endDay
    }
    laidOut.push({ slot, lane })
  })

  return laidOut
}

function subjectTrackHeight(laneCount: number): number {
  const base = 56
  const laneHeight = 46
  const topPadding = 6
  const bottomPadding = 6
  if (laneCount <= 1) return base
  return topPadding + bottomPadding + laneCount * laneHeight
}

function formatDateLabel(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${isoDate}T00:00:00Z`))
}

function formatSlotMeta(slot: TopicSlot): string {
  if (slot.startTime && slot.endTime) return `${slot.startTime} - ${slot.endTime} - ${slot.teacher}`
  if (slot.scheduleType === 'current') return 'Current syllabus'
  if (slot.scheduleType === 'coming') return 'Upcoming syllabus'
  return slot.teacher || 'Scheduled'
}

function getRangeDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const diffMs = end.getTime() - start.getTime()
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1
}

function truncate(value: string, len: number) {
  return value.length > len ? `${value.slice(0, len - 1)}...` : value
}

const MAP_NODE_WIDTH = 220
const MAP_NODE_HALF_WIDTH = MAP_NODE_WIDTH / 2
const MAP_NODE_HEIGHT = 72
const MAP_NODE_HALF_HEIGHT = MAP_NODE_HEIGHT / 2

function wrapTextByWords(value: string, maxCharsPerLine: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines: string[] = []
  let current = ''
  let consumedWords = 0

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxCharsPerLine) {
      current = next
      consumedWords += 1
      continue
    }
    if (current) lines.push(current)
    current = word
    consumedWords += 1
    if (lines.length >= maxLines - 1) break
  }

  if (lines.length < maxLines && current) {
    lines.push(current)
  }

  if (consumedWords < words.length) {
    const last = lines[lines.length - 1] ?? ''
    lines[lines.length - 1] = last.length > maxCharsPerLine - 3 ? `${last.slice(0, maxCharsPerLine - 3)}...` : `${last}...`
  }

  return lines.slice(0, maxLines)
}

function buildChainLayout(nodes: ChainNode[]) {
  if (!nodes.length) return { nodes: [] as PositionedNode[], width: 920, height: 420 }
  const groups = new Map<number, ChainNode[]>()
  nodes.forEach(node => {
    if (!groups.has(node.depth)) groups.set(node.depth, [])
    groups.get(node.depth)?.push(node)
  })
  const depths = Array.from(groups.keys()).sort((a, b) => a - b)
  const colGap = 260
  const rowGap = 96
  const padX = 90
  const padY = 70

  const maxRows = Math.max(...depths.map(depth => groups.get(depth)?.length ?? 0))
  const width = Math.max(920, padX * 2 + (depths.length - 1) * colGap + MAP_NODE_WIDTH + 20)
  const height = Math.max(420, padY * 2 + (maxRows - 1) * rowGap + 80)

  const positionedNodes: PositionedNode[] = []
  depths.forEach((depth, depthIndex) => {
    const group = [...(groups.get(depth) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    const x = padX + depthIndex * colGap + MAP_NODE_HALF_WIDTH
    const stackHeight = (group.length - 1) * rowGap
    const startY = height / 2 - stackHeight / 2
    group.forEach((node, idx) => {
      positionedNodes.push({
        ...node,
        x,
        y: startY + idx * rowGap,
      })
    })
  })

  return { nodes: positionedNodes, width, height }
}

function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
) {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t
  const x = mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x
  const y = mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y
  return { x, y }
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

export default function DashboardPage() {
  const initialSlots = useMemo(() => buildTopicSlots(), [])
  const { minDate: fallbackMinDate, maxDate: fallbackMaxDate } = useMemo(
    () => getTimelineBounds(initialSlots),
    [initialSlots]
  )

  const [rangeMinDate, setRangeMinDate] = useState(fallbackMinDate)
  const [rangeMaxDate, setRangeMaxDate] = useState(fallbackMaxDate)
  const [startDate, setStartDate] = useState<string | null>(null)
  const [endDate, setEndDate] = useState<string | null>(null)
  const [selectedSubjectId, setSelectedSubjectId] = useState('all')
  const [selectedWeek, setSelectedWeek] = useState('')
  const [keyword, setKeyword] = useState('')
  const [activeTab, setActiveTab] = useState<'home' | 'map'>('home')
  const [mapTabs, setMapTabs] = useState<MapTopicTab[]>([])
  const [activeMapTabId, setActiveMapTabId] = useState<string | null>(null)
  const [topicHistory, setTopicHistory] = useState<TopicRef[]>([])
  const [topicHistoryIndex, setTopicHistoryIndex] = useState(-1)

  const [allSubjects, setAllSubjects] = useState<Subject[]>([])
  const [visibleSubjects, setVisibleSubjects] = useState<Subject[]>([])
  const [weekOptions, setWeekOptions] = useState<{ week_start: string; week_end: string }[]>([])
  const [filteredSlots, setFilteredSlots] = useState<TopicSlot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [chainData, setChainData] = useState<TopicChainResponse | null>(null)
  const [chainLoading, setChainLoading] = useState(false)
  const [chainError, setChainError] = useState<string | null>(null)
  const [selectedTutorNodeKey, setSelectedTutorNodeKey] = useState<string | null>(null)
  const [tutorChats, setTutorChats] = useState<Record<string, TutorMessage[]>>({})
  const [tutorSuggestedPrompts, setTutorSuggestedPrompts] = useState<Record<string, string[]>>({})
  const [tutorEpisodeIds, setTutorEpisodeIds] = useState<Record<string, string>>({})
  const [tutorLoadedThreads, setTutorLoadedThreads] = useState<Record<string, boolean>>({})
  const [tutorInput, setTutorInput] = useState('')
  const [tutorLoading, setTutorLoading] = useState(false)
  const [tutorError, setTutorError] = useState<string | null>(null)
  const [mapViewMode, setMapViewMode] = useState<'map' | 'tutor' | 'resources'>('map')
  const tutorChatScrollRef = useRef<HTMLDivElement | null>(null)
  const tutorInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [mapNodePositions, setMapNodePositions] = useState<Record<string, { x: number; y: number }>>({})
  const mapSvgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    nodeKey: string
    startPointerX: number
    startPointerY: number
    startNodeX: number
    startNodeY: number
    moved: boolean
  } | null>(null)
  const suppressClickNodeRef = useRef<string | null>(null)
  const resourceFileInputRef = useRef<HTMLInputElement | null>(null)

  const [topicResourcesByKey, setTopicResourcesByKey] = useState<Record<string, TopicResource[]>>({})
  const [topicResourcesLoadingByKey, setTopicResourcesLoadingByKey] = useState<Record<string, boolean>>({})
  const [resourceLabelDraft, setResourceLabelDraft] = useState('')
  const [resourceUrlDraft, setResourceUrlDraft] = useState('')
  const [resourceNoteDraft, setResourceNoteDraft] = useState('')
  const [resourceActionLoading, setResourceActionLoading] = useState(false)
  const [resourceError, setResourceError] = useState<string | null>(null)
  const [resourceShareMenuId, setResourceShareMenuId] = useState<string | null>(null)
  const [resourceShareTargetById, setResourceShareTargetById] = useState<Record<string, string>>({})
  const [shareUsers, setShareUsers] = useState<ShareUser[]>([])
  const [shareUsersLoading, setShareUsersLoading] = useState(false)
  const [shareUsersLoaded, setShareUsersLoaded] = useState(false)
  const [tutorShareEmail, setTutorShareEmail] = useState('')
  const [resourceAddMode, setResourceAddMode] = useState<'file' | 'link' | 'note'>('file')
  const sharePopoverRef = useRef<HTMLDivElement | null>(null)

  const activeMapTopic = useMemo(
    () => mapTabs.find(tab => tab.id === activeMapTabId) ?? null,
    [activeMapTabId, mapTabs]
  )
  const activeTopicResourceKey = useMemo(
    () => (activeMapTopic ? conceptKey(activeMapTopic.title, activeMapTopic.subject) : null),
    [activeMapTopic]
  )
  const activeTopicResources =
    activeTopicResourceKey && topicResourcesByKey[activeTopicResourceKey]
      ? topicResourcesByKey[activeTopicResourceKey]
      : []
  const selectedTutorNode = useMemo(() => {
    if (!selectedTutorNodeKey || !chainData) return null
    return chainData.nodes.find(node => node.key === selectedTutorNodeKey) ?? null
  }, [chainData, selectedTutorNodeKey])
  const tutorThreadKey = activeMapTabId && selectedTutorNodeKey ? `${activeMapTabId}::${selectedTutorNodeKey}` : null
  const tutorMessages = tutorThreadKey ? tutorChats[tutorThreadKey] ?? [] : []
  const tutorQuickPrompts = useMemo(() => {
    if (!selectedTutorNode) return [] as string[]
    const fallback = [
      `Explain ${selectedTutorNode.name} in simple terms`,
      `Give me a real-world analogy for ${selectedTutorNode.name}`,
      `Quiz me with 3 quick checks on ${selectedTutorNode.name}`,
      `What should I learn before ${selectedTutorNode.name}?`,
    ]
    if (!tutorThreadKey) return fallback
    return tutorSuggestedPrompts[tutorThreadKey] ?? fallback
  }, [selectedTutorNode, tutorSuggestedPrompts, tutorThreadKey])

  useEffect(() => {
    const controller = new AbortController()
    async function loadFilteredTimeline() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ subject_id: selectedSubjectId })
        if (startDate) params.set('start_date', startDate)
        if (endDate) params.set('end_date', endDate)
        if (keyword.trim()) {
          params.set('search', keyword.trim())
        }
        const res = await fetch(`/api/dashboard/timeline?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`Failed to load filters (HTTP ${res.status})`)
        }
        const data = (await res.json()) as TimelineResponse
        setRangeMinDate(data.filters.minDate)
        setRangeMaxDate(data.filters.maxDate)
        setVisibleSubjects(data.subjects)
        setAllSubjects(data.allSubjects)
        setWeekOptions(data.weeks ?? [])
        setFilteredSlots(data.topicSlots)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load timeline')
      } finally {
        setLoading(false)
      }
    }

    void loadFilteredTimeline()
    return () => controller.abort()
  }, [endDate, keyword, selectedSubjectId, startDate])

  useEffect(() => {
    if (!selectedWeek) return
    const [weekStart, weekEnd] = selectedWeek.split('|')
    const exists = weekOptions.some(option => option.week_start === weekStart && option.week_end === weekEnd)
    if (!exists) {
      setSelectedWeek('')
    }
  }, [selectedWeek, weekOptions])

  useEffect(() => {
    if (activeTab !== 'map' || !activeMapTopic) return
    const topic = activeMapTopic
    const controller = new AbortController()
    async function loadTopicChain() {
      setChainLoading(true)
      setChainError(null)
      try {
        const params = new URLSearchParams({
          topic: topic.title,
        })
        if (topic.subject) {
          params.set('subject', topic.subject)
        }
        const res = await fetch(`/api/dashboard/topic-chain?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`Failed to load topic chain (HTTP ${res.status})`)
        }
        const data = (await res.json()) as TopicChainResponse
        setChainData(data)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setChainError(err instanceof Error ? err.message : 'Failed to load topic chain')
      } finally {
        setChainLoading(false)
      }
    }

    void loadTopicChain()
    return () => controller.abort()
  }, [activeMapTopic, activeTab])

  useEffect(() => {
    setMapNodePositions({})
  }, [activeMapTabId, chainData?.focusKey])

  useEffect(() => {
    if (!chainData?.nodes.length) {
      setSelectedTutorNodeKey(null)
      return
    }
    setSelectedTutorNodeKey(prev => {
      if (prev && chainData.nodes.some(node => node.key === prev)) return prev
      return chainData.focusKey
    })
  }, [chainData])

  useEffect(() => {
    const el = tutorChatScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [tutorLoading, tutorMessages, tutorThreadKey])

  useEffect(() => {
    if (!tutorThreadKey || !selectedTutorNode || !activeMapTopic) return
    if (tutorLoadedThreads[tutorThreadKey]) return

    let cancelled = false
    const threadKey = tutorThreadKey
    const topic = activeMapTopic
    const node = selectedTutorNode
    async function loadTutorThread() {
      try {
        const params = new URLSearchParams({
          map_topic: topic.title,
          node_name: node.name,
        })
        if (topic.subject) params.set('map_subject', topic.subject)
        if (node.subject) params.set('node_subject', node.subject)

        const res = await fetch(`/api/dashboard/tutor?${params.toString()}`)
        if (!res.ok) {
          throw new Error(`Failed to load tutor thread (HTTP ${res.status})`)
        }
        const payload = (await res.json()) as {
          episodeId: string | null
          messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
          suggestedPrompts?: string[]
        }
        if (cancelled) return

        setTutorChats(prev => ({
          ...prev,
          [threadKey]: (payload.messages ?? []).map(message => ({
            id: message.id,
            role: message.role,
            content: message.content,
          })),
        }))
        setTutorSuggestedPrompts(prev => ({
          ...prev,
          [threadKey]: (payload.suggestedPrompts ?? []).filter(Boolean),
        }))
        if (payload.episodeId) {
          setTutorEpisodeIds(prev => ({
            ...prev,
            [threadKey]: payload.episodeId!,
          }))
        }
      } catch (err) {
        if (cancelled) return
        setTutorError(err instanceof Error ? err.message : 'Failed to load tutor history')
      } finally {
        if (cancelled) return
        setTutorLoadedThreads(prev => ({
          ...prev,
          [threadKey]: true,
        }))
      }
    }

    void loadTutorThread()
    return () => {
      cancelled = true
    }
  }, [activeMapTopic, selectedTutorNode, tutorLoadedThreads, tutorThreadKey])

  useEffect(() => {
    if (!resourceShareMenuId) return
    function handleClickOutside(event: MouseEvent) {
      if (sharePopoverRef.current && !sharePopoverRef.current.contains(event.target as Node)) {
        setResourceShareMenuId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [resourceShareMenuId])

  useEffect(() => {
    if (!activeMapTopic || !activeTopicResourceKey) return
    let cancelled = false

    async function loadTopicResources(topicTitle: string, topicSubject: string | null, key: string) {
      setTopicResourcesLoadingByKey(prev => ({ ...prev, [key]: true }))
      setResourceError(null)
      try {
        const params = new URLSearchParams({ topic_title: topicTitle })
        if (topicSubject) params.set('topic_subject', topicSubject)
        const res = await fetch(`/api/dashboard/topic-resources?${params.toString()}`)
        const payload = (await res.json()) as { resources?: TopicResource[]; error?: string }
        if (!res.ok) {
          throw new Error(payload.error ?? `Failed to load topic resources (HTTP ${res.status})`)
        }
        if (cancelled) return
        setTopicResourcesByKey(prev => ({
          ...prev,
          [key]: payload.resources ?? [],
        }))
      } catch (err) {
        if (cancelled) return
        setResourceError(err instanceof Error ? err.message : 'Could not load topic resources')
      } finally {
        if (cancelled) return
        setTopicResourcesLoadingByKey(prev => ({ ...prev, [key]: false }))
      }
    }

    void loadTopicResources(activeMapTopic.title, activeMapTopic.subject, activeTopicResourceKey)
    return () => {
      cancelled = true
    }
  }, [activeMapTopic, activeTopicResourceKey])

  const selectedDateRangeLabel =
    startDate && endDate
      ? startDate === endDate
        ? formatDateLabel(startDate)
        : `${formatDateLabel(startDate)} to ${formatDateLabel(endDate)}`
      : 'Not selected'

  const sortedSlots = useMemo(() => {
    return [...filteredSlots].sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate)
      if (a.startDay !== b.startDay) return a.startDay - b.startDay
      return a.startTime.localeCompare(b.startTime)
    })
  }, [filteredSlots])

  const rangeDays = useMemo(() => {
    if (!startDate || !endDate) return Number.POSITIVE_INFINITY
    return getRangeDays(startDate, endDate)
  }, [endDate, startDate])
  const isWeeklyRange = rangeDays <= 7

  const groupedBySubject = useMemo(() => {
    return visibleSubjects
      .map(subject => ({
        subject,
        slots: sortedSlots.filter(slot => slot.subjectId === subject.id),
      }))
      .filter(group => group.slots.length > 0)
  }, [sortedSlots, visibleSubjects])

  const chainLayout = useMemo(() => {
    if (!chainData) return null
    const layout = buildChainLayout(chainData.nodes)
    const nodes = layout.nodes.map(node => {
      const moved = mapNodePositions[node.key]
      if (!moved) return node
      return { ...node, x: moved.x, y: moved.y }
    })
    const nodeMap = new Map(nodes.map(node => [node.key, node]))
    return { ...layout, nodes, nodeMap }
  }, [chainData, mapNodePositions])

  const edgeRenderData = useMemo<EdgeRenderData[]>(() => {
    if (!chainData || !chainLayout) return []
    const occupiedLabelBoxes: Array<{ x: number; y: number; width: number; height: number }> = []
    const nodeBoxes = chainLayout.nodes.map(node => ({
      x: node.x - MAP_NODE_HALF_WIDTH - 2,
      y: node.y - MAP_NODE_HALF_HEIGHT - 2,
      width: MAP_NODE_WIDTH + 4,
      height: MAP_NODE_HEIGHT + 4,
    }))

    return chainData.edges.flatMap(edge => {
      const from = chainLayout.nodeMap.get(edge.fromKey)
      const to = chainLayout.nodeMap.get(edge.toKey)
      if (!from || !to) return []

      const startX = from.x + MAP_NODE_HALF_WIDTH
      const endX = to.x - MAP_NODE_HALF_WIDTH
      const controlX = (startX + endX) / 2
      const p0 = { x: startX, y: from.y }
      const p1 = { x: controlX, y: from.y }
      const p2 = { x: controlX, y: to.y }
      const p3 = { x: endX, y: to.y }
      const path = `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`

      const label = truncate(edge.relationship, 28)
      const labelWidth = Math.max(72, Math.min(190, label.length * 6.4 + 14))
      const labelHeight = 18
      const tCandidates = [0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76]
      const yOffsets = [0, -18, 18, -30, 30, -42, 42, -54, 54]

      let chosenX = (startX + endX) / 2
      let chosenY = (from.y + to.y) / 2
      let foundPlacement = false

      for (const t of tCandidates) {
        const base = cubicPoint(p0, p1, p2, p3, t)
        for (const offset of yOffsets) {
          const candidateBox = {
            x: base.x - labelWidth / 2,
            y: base.y + offset - labelHeight / 2,
            width: labelWidth,
            height: labelHeight,
          }
          if (
            candidateBox.x < 8 ||
            candidateBox.y < 8 ||
            candidateBox.x + candidateBox.width > chainLayout.width - 8 ||
            candidateBox.y + candidateBox.height > chainLayout.height - 8
          ) {
            continue
          }
          const overlapsNode = nodeBoxes.some(nodeBox => boxesOverlap(candidateBox, nodeBox))
          if (overlapsNode) continue
          const overlapsLabel = occupiedLabelBoxes.some(labelBox => boxesOverlap(candidateBox, labelBox))
          if (overlapsLabel) continue
          chosenX = base.x
          chosenY = base.y + offset
          occupiedLabelBoxes.push(candidateBox)
          foundPlacement = true
          break
        }
        if (foundPlacement) break
      }

      if (!foundPlacement) {
        // Guaranteed non-overlap fallback lane near top-left.
        let fallbackPlaced = false
        for (let row = 0; row < 8 && !fallbackPlaced; row += 1) {
          for (let col = 0; col < 5 && !fallbackPlaced; col += 1) {
            const x = 16 + col * 180
            const y = 16 + row * 22
            const candidateBox = { x, y, width: labelWidth, height: labelHeight }
            if (candidateBox.x + candidateBox.width > chainLayout.width - 8) continue
            if (candidateBox.y + candidateBox.height > chainLayout.height - 8) continue
            const overlapsNode = nodeBoxes.some(nodeBox => boxesOverlap(candidateBox, nodeBox))
            if (overlapsNode) continue
            const overlapsLabel = occupiedLabelBoxes.some(labelBox => boxesOverlap(candidateBox, labelBox))
            if (overlapsLabel) continue
            chosenX = candidateBox.x + labelWidth / 2
            chosenY = candidateBox.y + labelHeight / 2
            occupiedLabelBoxes.push(candidateBox)
            fallbackPlaced = true
          }
        }
        if (!fallbackPlaced) {
          const fallbackBox = {
            x: clamp(chosenX - labelWidth / 2, 8, chainLayout.width - labelWidth - 8),
            y: clamp(chosenY - labelHeight / 2, 8, chainLayout.height - labelHeight - 8),
            width: labelWidth,
            height: labelHeight,
          }
          chosenX = fallbackBox.x + labelWidth / 2
          chosenY = fallbackBox.y + labelHeight / 2
          occupiedLabelBoxes.push(fallbackBox)
        }
      }

      return [
        {
          edge,
          path,
          label,
          labelX: chosenX,
          labelY: chosenY,
          labelWidth,
        },
      ]
    })
  }, [chainData, chainLayout])

  const tutorContext = useMemo(() => {
    if (!selectedTutorNode || !chainData) {
      return { upstream: [] as string[], downstream: [] as string[], relatedEdges: [] as string[] }
    }
    const upstream = chainData.edges
      .filter(edge => edge.toKey === selectedTutorNode.key)
      .map(edge => {
        const fromNode = chainData.nodes.find(node => node.key === edge.fromKey)
        return fromNode?.name ?? parseConceptKey(edge.fromKey).name
      })
    const downstream = chainData.edges
      .filter(edge => edge.fromKey === selectedTutorNode.key)
      .map(edge => {
        const toNode = chainData.nodes.find(node => node.key === edge.toKey)
        return toNode?.name ?? parseConceptKey(edge.toKey).name
      })
    const relatedEdges = chainData.edges
      .filter(edge => edge.fromKey === selectedTutorNode.key || edge.toKey === selectedTutorNode.key)
      .map(edge => {
        const fromNode = chainData.nodes.find(node => node.key === edge.fromKey)
        const toNode = chainData.nodes.find(node => node.key === edge.toKey)
        return `${fromNode?.name ?? parseConceptKey(edge.fromKey).name} -> ${toNode?.name ?? parseConceptKey(edge.toKey).name} (${edge.relationship})`
      })

    return {
      upstream: Array.from(new Set(upstream)),
      downstream: Array.from(new Set(downstream)),
      relatedEdges: Array.from(new Set(relatedEdges)),
    }
  }, [chainData, selectedTutorNode])

  function pointerToMap(clientX: number, clientY: number) {
    const svg = mapSvgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const vb = svg.viewBox.baseVal
    return {
      x: vb.x + ((clientX - rect.left) / Math.max(1, rect.width)) * vb.width,
      y: vb.y + ((clientY - rect.top) / Math.max(1, rect.height)) * vb.height,
    }
  }

  function handleMapNodePointerDown(event: React.PointerEvent<SVGGElement>, node: PositionedNode) {
    event.stopPropagation()
    const p = pointerToMap(event.clientX, event.clientY)
    dragRef.current = {
      pointerId: event.pointerId,
      nodeKey: node.key,
      startPointerX: p.x,
      startPointerY: p.y,
      startNodeX: node.x,
      startNodeY: node.y,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleMapPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!chainLayout || !dragRef.current) return
    if (dragRef.current.pointerId !== event.pointerId) return
    const p = pointerToMap(event.clientX, event.clientY)
    const dx = p.x - dragRef.current.startPointerX
    const dy = p.y - dragRef.current.startPointerY
    if (!dragRef.current.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      dragRef.current.moved = true
    }
    const nextX = clamp(dragRef.current.startNodeX + dx, MAP_NODE_HALF_WIDTH + 10, chainLayout.width - MAP_NODE_HALF_WIDTH - 10)
    const nextY = clamp(
      dragRef.current.startNodeY + dy,
      MAP_NODE_HALF_HEIGHT + 10,
      chainLayout.height - MAP_NODE_HALF_HEIGHT - 10
    )
    setMapNodePositions(prev => ({
      ...prev,
      [dragRef.current!.nodeKey]: { x: nextX, y: nextY },
    }))
  }

  function handleMapPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current && dragRef.current.pointerId === event.pointerId) {
      if (dragRef.current.moved) {
        suppressClickNodeRef.current = dragRef.current.nodeKey
      }
      dragRef.current = null
    }
  }

  function openTopicInMapTabs(topic: TopicRef, pushHistory = true) {
    const id = conceptKey(topic.title, topic.subject)
    setMapTabs(prev => {
      if (prev.some(tab => tab.id === id)) return prev
      return [...prev, { ...topic, id }]
    })
    setActiveMapTabId(id)
    setActiveTab('map')
    setMapViewMode('map')
    if (!pushHistory) return

    const base = topicHistoryIndex >= 0 ? topicHistory.slice(0, topicHistoryIndex + 1) : []
    const last = base[base.length - 1]
    if (last && last.title === topic.title && last.subject === topic.subject) return
    const next = [...base, topic]
    setTopicHistory(next)
    setTopicHistoryIndex(next.length - 1)
  }

  function openTopicMap(slot: TopicSlot) {
    const subjectName = allSubjects.find(subject => subject.id === slot.subjectId)?.name ?? slot.subjectId
    openTopicInMapTabs({ title: slot.title, subject: subjectName })
  }

  function goBackInMapHistory() {
    if (topicHistoryIndex <= 0) return
    const nextIndex = topicHistoryIndex - 1
    const topic = topicHistory[nextIndex]
    if (!topic) return
    setTopicHistoryIndex(nextIndex)
    openTopicInMapTabs(topic, false)
  }

  function closeMapTab(tabId: string) {
    setMapTabs(prev => {
      const idx = prev.findIndex(tab => tab.id === tabId)
      if (idx === -1) return prev
      const nextTabs = prev.filter(tab => tab.id !== tabId)
      if (activeMapTabId === tabId) {
        const fallback = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0] ?? null
        setActiveMapTabId(fallback?.id ?? null)
        if (!fallback) {
          setChainData(null)
          setChainError(null)
        }
      }
      return nextTabs
    })
  }

  async function sendTutorMessage(rawQuestion: string) {
    if (!selectedTutorNode || !tutorThreadKey || !activeMapTopic) return
    const question = rawQuestion.trim()
    if (!question) return

    const userMessage: TutorMessage = {
      id: `${Date.now()}-u`,
      role: 'user',
      content: question,
    }
    const previous = tutorChats[tutorThreadKey] ?? []
    const nextMessages = [...previous, userMessage]

    setTutorChats(prev => ({
      ...prev,
      [tutorThreadKey]: nextMessages,
    }))
    setTutorInput('')
    setTutorError(null)
    setTutorLoading(true)

    try {
      const res = await fetch('/api/dashboard/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: tutorEpisodeIds[tutorThreadKey] ?? null,
          mapTopic: { title: activeMapTopic.title, subject: activeMapTopic.subject },
          node: {
            name: selectedTutorNode.name,
            subject: selectedTutorNode.subject,
            kind: selectedTutorNode.kind,
          },
          question,
          history: nextMessages.map(message => ({
            role: message.role,
            content: message.content,
          })),
          context: tutorContext,
        }),
      })
      const payload = (await res.json()) as { answer?: string; error?: string; episodeId?: string | null }
      const suggestedPrompts = (payload as { suggestedPrompts?: string[] }).suggestedPrompts ?? []
      if (!res.ok) {
        throw new Error(payload.error ?? `Tutor failed (HTTP ${res.status})`)
      }
      const answer = payload.answer?.trim() || 'I could not generate a response right now.'
      const assistantMessage: TutorMessage = {
        id: `${Date.now()}-a`,
        role: 'assistant',
        content: answer,
      }
      setTutorChats(prev => ({
        ...prev,
        [tutorThreadKey]: [...(prev[tutorThreadKey] ?? nextMessages), assistantMessage],
      }))
      if (payload.episodeId) {
        setTutorEpisodeIds(prev => ({
          ...prev,
          [tutorThreadKey]: payload.episodeId!,
        }))
      }
      setTutorSuggestedPrompts(prev => ({
        ...prev,
        [tutorThreadKey]: suggestedPrompts.filter(Boolean),
      }))
      setTutorLoadedThreads(prev => ({
        ...prev,
        [tutorThreadKey]: true,
      }))
    } catch (err) {
      setTutorError(err instanceof Error ? err.message : 'Tutor failed to respond')
    } finally {
      setTutorLoading(false)
    }
  }

  async function clearTutorThread() {
    if (!tutorThreadKey) return
    const episodeId = tutorEpisodeIds[tutorThreadKey]
    if (episodeId) {
      try {
        const params = new URLSearchParams({ episode_id: episodeId })
        await fetch(`/api/dashboard/tutor?${params.toString()}`, { method: 'DELETE' })
      } catch {
        // Keep local clear behavior even if remote cleanup fails.
      }
    }
    setTutorChats(prev => {
      const next = { ...prev }
      delete next[tutorThreadKey]
      return next
    })
    setTutorEpisodeIds(prev => {
      const next = { ...prev }
      delete next[tutorThreadKey]
      return next
    })
    setTutorLoadedThreads(prev => ({
      ...prev,
      [tutorThreadKey]: true,
    }))
    setTutorSuggestedPrompts(prev => {
      const next = { ...prev }
      delete next[tutorThreadKey]
      return next
    })
    setTutorInput('')
    setTutorError(null)
  }

  function openTutorForNode(nodeKey: string) {
    setSelectedTutorNodeKey(nodeKey)
    setTutorError(null)
    setMapViewMode('tutor')
  }

  function applySuggestedPromptToInput(prompt: string) {
    setTutorInput(prompt)
    requestAnimationFrame(() => {
      tutorInputRef.current?.focus()
    })
  }

  async function uploadTopicFile(file: File) {
    if (!activeMapTopic || !activeTopicResourceKey) return
    setResourceActionLoading(true)
    setResourceError(null)
    try {
      const form = new FormData()
      form.append('topic_title', activeMapTopic.title)
      if (activeMapTopic.subject) {
        form.append('topic_subject', activeMapTopic.subject)
      }
      if (resourceLabelDraft.trim()) {
        form.append('label', resourceLabelDraft.trim())
      }
      form.append('file', file)

      const res = await fetch('/api/dashboard/topic-resources', {
        method: 'POST',
        body: form,
      })
      const payload = (await res.json()) as { resource?: TopicResource; error?: string }
      if (!res.ok) {
        throw new Error(payload.error ?? `Upload failed (HTTP ${res.status})`)
      }
      if (!payload.resource) {
        throw new Error('Upload succeeded but no resource was returned.')
      }
      setTopicResourcesByKey(prev => ({
        ...prev,
        [activeTopicResourceKey]: [payload.resource!, ...(prev[activeTopicResourceKey] ?? [])],
      }))
      setResourceLabelDraft('')
      if (resourceFileInputRef.current) {
        resourceFileInputRef.current.value = ''
      }
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : 'Could not upload file')
    } finally {
      setResourceActionLoading(false)
    }
  }

  async function addTopicUrl() {
    if (!activeMapTopic || !activeTopicResourceKey) return
    const url = resourceUrlDraft.trim()
    if (!url) return

    setResourceActionLoading(true)
    setResourceError(null)
    try {
      const res = await fetch('/api/dashboard/topic-resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicTitle: activeMapTopic.title,
          topicSubject: activeMapTopic.subject,
          label: resourceLabelDraft.trim() || null,
          url,
        }),
      })
      const payload = (await res.json()) as { resource?: TopicResource; error?: string }
      if (!res.ok) {
        throw new Error(payload.error ?? `Could not add URL (HTTP ${res.status})`)
      }
      if (!payload.resource) {
        throw new Error('URL added but no resource was returned.')
      }
      setTopicResourcesByKey(prev => ({
        ...prev,
        [activeTopicResourceKey]: [payload.resource!, ...(prev[activeTopicResourceKey] ?? [])],
      }))
      setResourceUrlDraft('')
      setResourceLabelDraft('')
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : 'Could not add URL')
    } finally {
      setResourceActionLoading(false)
    }
  }

  async function addTopicNote() {
    if (!activeMapTopic || !activeTopicResourceKey) return
    const note = resourceNoteDraft.trim()
    if (!note) return

    setResourceActionLoading(true)
    setResourceError(null)
    try {
      const res = await fetch('/api/dashboard/topic-resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicTitle: activeMapTopic.title,
          topicSubject: activeMapTopic.subject,
          label: resourceLabelDraft.trim() || null,
          noteContent: note,
        }),
      })
      const payload = (await res.json()) as { resource?: TopicResource; error?: string }
      if (!res.ok) {
        throw new Error(payload.error ?? `Could not add note (HTTP ${res.status})`)
      }
      if (!payload.resource) {
        throw new Error('Note added but no resource was returned.')
      }
      setTopicResourcesByKey(prev => ({
        ...prev,
        [activeTopicResourceKey]: [payload.resource!, ...(prev[activeTopicResourceKey] ?? [])],
      }))
      setResourceNoteDraft('')
      setResourceLabelDraft('')
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : 'Could not add note')
    } finally {
      setResourceActionLoading(false)
    }
  }

  async function shareTopicResource(resourceId: string, directUserId?: string) {
    const targetUserId = (directUserId ?? resourceShareTargetById[resourceId] ?? '').trim()
    if (!targetUserId) return
    setResourceActionLoading(true)
    setResourceError(null)
    try {
      const res = await fetch('/api/dashboard/topic-resources/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId,
          targetUserId,
        }),
      })
      const payload = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok) {
        throw new Error(payload.error ?? `Could not share resource (HTTP ${res.status})`)
      }
      setResourceShareTargetById(prev => ({ ...prev, [resourceId]: '' }))
      setResourceShareMenuId(null)
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : 'Could not share resource')
    } finally {
      setResourceActionLoading(false)
    }
  }

  async function ensureShareUsersLoaded() {
    if (shareUsersLoaded || shareUsersLoading) return
    setShareUsersLoading(true)
    try {
      const res = await fetch('/api/dashboard/share-users')
      const payload = (await res.json()) as { users?: ShareUser[]; error?: string }
      if (!res.ok) {
        throw new Error(payload.error ?? `Could not load users (HTTP ${res.status})`)
      }
      setShareUsers(payload.users ?? [])
      setShareUsersLoaded(true)
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : 'Could not load users')
    } finally {
      setShareUsersLoading(false)
    }
  }

  async function shareTutorEpisode() {
    if (!tutorThreadKey) return
    const episodeId = tutorEpisodeIds[tutorThreadKey]
    if (!episodeId) {
      setTutorError('Send at least one message first, then share this chat.')
      return
    }
    const email = tutorShareEmail.trim()
    if (!email) return

    setTutorLoading(true)
    setTutorError(null)
    try {
      const res = await fetch('/api/dashboard/tutor/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, targetEmail: email }),
      })
      const payload = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok) {
        throw new Error(payload.error ?? `Could not share chat (HTTP ${res.status})`)
      }
      setTutorShareEmail('')
    } catch (err) {
      setTutorError(err instanceof Error ? err.message : 'Could not share chat')
    } finally {
      setTutorLoading(false)
    }
  }

  async function removeTopicResource(resourceId: string) {
    if (!activeTopicResourceKey) return
    setResourceActionLoading(true)
    setResourceError(null)
    try {
      const res = await fetch('/api/dashboard/topic-resources', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: resourceId }),
      })
      const payload = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok) {
        throw new Error(payload.error ?? `Could not remove resource (HTTP ${res.status})`)
      }
      setTopicResourcesByKey(prev => ({
        ...prev,
        [activeTopicResourceKey]: (prev[activeTopicResourceKey] ?? []).filter(item => item.id !== resourceId),
      }))
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : 'Could not remove resource')
    } finally {
      setResourceActionLoading(false)
    }
  }

  function renderHomeTab() {
    return (
      <>
        <section className="card dash-filter-bar">
          <div className="dash-filter-grid">
            <div className="dash-filter-field">
              <label>Date range</label>
              <div className="dash-slider-wrap">
                <DateRangePicker
                  value={{ startDate, endDate }}
                  minDate={rangeMinDate}
                  maxDate={rangeMaxDate}
                  onChange={range => {
                    setStartDate(range.startDate)
                    setEndDate(range.endDate)
                    setSelectedWeek('')
                  }}
                />
                <span className="dash-filter-value">{selectedDateRangeLabel}</span>
              </div>
            </div>

            <div className="dash-filter-field">
              <label htmlFor="subject-filter">Subject filter</label>
              <select
                id="subject-filter"
                value={selectedSubjectId}
                onChange={e => setSelectedSubjectId(e.target.value)}
              >
                <option value="all">All subjects</option>
                {allSubjects.map(subject => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="dash-filter-field">
              <label htmlFor="week-filter">Week</label>
              <select
                id="week-filter"
                value={selectedWeek}
                onChange={e => {
                  const value = e.target.value
                  setSelectedWeek(value)
                  if (!value) return
                  const [weekStart, weekEnd] = value.split('|')
                  if (!weekStart || !weekEnd) return
                  setStartDate(weekStart)
                  setEndDate(weekEnd)
                }}
              >
                <option value="">All weeks</option>
                {weekOptions.map(option => {
                  const label = `${option.week_start} -> ${option.week_end}`
                  return (
                    <option key={label} value={`${option.week_start}|${option.week_end}`}>
                      {label}
                    </option>
                  )
                })}
              </select>
            </div>

            <div className="dash-filter-field">
              <label htmlFor="keyword-filter">Keyword search</label>
              <input
                id="keyword-filter"
                type="text"
                placeholder="Quadratic, motion, IB, ..."
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
              />
            </div>

            <div className="dash-filter-actions">
              <button
                type="button"
                className="dash-reset-btn"
                onClick={() => {
                  setStartDate(null)
                  setEndDate(null)
                  setSelectedSubjectId('all')
                  setSelectedWeek('')
                  setKeyword('')
                }}
              >
                Reset filters
              </button>
            </div>
          </div>
        </section>

        <section>
          {error ? (
            <div className="card">
              <p className="err" style={{ margin: 0 }}>
                {error}
              </p>
            </div>
          ) : null}

          <div className="dash-main-stack">
            <section className="card">
              <div className="dash-card-head">
                <h2 className="graph-section-title">
                  {isWeeklyRange ? 'Topics on timescale' : 'Topics in selected range'}
                </h2>
                <span className="dash-week-chip">{loading ? 'Updating...' : selectedDateRangeLabel}</span>
              </div>

              {visibleSubjects.length === 0 || filteredSlots.length === 0 ? (
                <p className="lead" style={{ margin: 0 }}>
                  No topics match the selected filters.
                </p>
              ) : !isWeeklyRange ? (
                <div className="dash-long-range-wrap">
                  <p className="dash-long-range-note">
                    Timescale view is shown only for up to 7 days. For broader ranges, topics are grouped
                    by subject. Click any topic to open its dependency map.
                  </p>
                  <div className="dash-long-range-grid">
                    {groupedBySubject.map(group => (
                      <section className="dash-long-range-subject" key={group.subject.id}>
                        <div className="dash-long-range-head">
                          <span className="dash-color-dot" style={{ backgroundColor: group.subject.color }} />
                          <strong>{group.subject.name}</strong>
                          <span className="dash-subject-code">{group.subject.shortCode}</span>
                        </div>
                        <div className="dash-long-range-list">
                          {group.slots.map(slot => (
                            <button
                              key={slot.id}
                              type="button"
                              className="dash-long-range-item dash-topic-click"
                              onClick={() => openTopicMap(slot)}
                            >
                              <div className="dash-long-range-title">{slot.title}</div>
                              <div className="dash-topic-meta">
                                {formatDateLabel(slot.startDate)}
                                {slot.endDate !== slot.startDate
                                  ? ` - ${formatDateLabel(slot.endDate)}`
                                  : ''}
                                {` · ${formatSlotMeta(slot)}`}
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="dash-timeline-header">
                    {timelineDays.map(day => (
                      <div key={day}>{day}</div>
                    ))}
                  </div>
                  <div className="dash-rows">
                    {visibleSubjects.map(subject => {
                      const slots = filteredSlots.filter(slot => slot.subjectId === subject.id)
                      const laidOutSlots = layoutSlotsIntoLanes(slots)
                      const laneCount =
                        laidOutSlots.length > 0
                          ? Math.max(...laidOutSlots.map(item => item.lane)) + 1
                          : 1

                      return (
                        <div className="dash-row" key={subject.id}>
                          <div className="dash-row-label">
                            <span className="dash-color-dot" style={{ backgroundColor: subject.color }} />
                            <span>{subject.shortCode}</span>
                          </div>
                          <div
                            className="dash-row-track"
                            style={{ minHeight: `${subjectTrackHeight(laneCount)}px` }}
                          >
                            {timelineDays.map(day => (
                              <span key={day} className="dash-grid-cell" />
                            ))}
                            {laidOutSlots.map(({ slot, lane }) => (
                              <button
                                key={slot.id}
                                type="button"
                                className="dash-topic-slot dash-topic-click"
                                onClick={() => openTopicMap(slot)}
                                style={{
                                  ...getSlotStyle(slot),
                                  borderColor: `${subject.color}AA`,
                                  top: `${6 + lane * 46}px`,
                                  height: '40px',
                                }}
                              >
                                <div className="dash-topic-title">{slot.title}</div>
                                <div className="dash-topic-meta">{formatSlotMeta(slot)}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </section>

            <section className="card">
              <h2 className="graph-section-title">Topic queue</h2>
              <div className="dash-topic-list">
                {sortedSlots.map(slot => {
                  const subject = allSubjects.find(item => item.id === slot.subjectId)
                  if (!subject) return null
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      className="dash-topic-card dash-topic-click"
                      onClick={() => openTopicMap(slot)}
                    >
                      <div className="dash-topic-card-top">
                        <span
                          className="dash-pill"
                          style={{
                            color: subject.color,
                            borderColor: `${subject.color}66`,
                            backgroundColor: `${subject.color}22`,
                          }}
                        >
                          {subject.name}
                        </span>
                        <span className="dash-topic-window">
                          {formatDateLabel(slot.startDate)}
                          {slot.endDate !== slot.startDate ? ` - ${formatDateLabel(slot.endDate)}` : ''}
                        </span>
                      </div>
                      <h3>{slot.title}</h3>
                      <p>{formatSlotMeta(slot)}</p>
                    </button>
                  )
                })}
                {sortedSlots.length === 0 ? (
                  <p className="lead" style={{ margin: 0 }}>
                    No topics match the selected filters.
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        </section>
      </>
    )
  }

  function renderMapTab() {
    return (
      <section className="dash-main-stack">
        <section className="card">
          <div className="dash-card-head">
            <div>
              <h2 className="graph-section-title">Topic dependency map</h2>
              <p className="dash-long-range-note" style={{ margin: 0 }}>
                Click a topic in Home to inspect its prerequisites and downstream dependencies.
              </p>
            </div>
            <div className="dash-map-header-actions">
              <button
                type="button"
                className="dash-reset-btn"
                onClick={goBackInMapHistory}
                disabled={topicHistoryIndex <= 0}
              >
                Back
              </button>
              {activeMapTopic ? (
                <span className="dash-week-chip">
                  {activeMapTopic.title}
                  {activeMapTopic.subject ? ` · ${activeMapTopic.subject}` : ''}
                </span>
              ) : null}
            </div>
          </div>

          {mapTabs.length > 0 ? (
            <div className="dash-map-tabstrip">
              {mapTabs.map(tab => (
                <div
                  key={tab.id}
                  className={`dash-map-tabchip ${activeMapTabId === tab.id ? 'dash-map-tabchip-active' : ''}`}
                >
                  <button
                    type="button"
                    className="dash-map-tabchip-main"
                    onClick={() => {
                      setActiveMapTabId(tab.id)
                      setActiveTab('map')
                    }}
                  >
                    {truncate(tab.title, 28)}
                  </button>
                  <button
                    type="button"
                    className="dash-map-tabchip-close"
                    onClick={() => closeMapTab(tab.id)}
                    aria-label={`Close ${tab.title}`}
                    title="Close"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {activeMapTopic ? (
            <div className="dash-map-view-tabstrip" role="tablist" aria-label="Map study views">
              <button
                type="button"
                className={`dash-map-view-tab ${mapViewMode === 'map' ? 'dash-map-view-tab-active' : ''}`}
                role="tab"
                aria-selected={mapViewMode === 'map'}
                onClick={() => setMapViewMode('map')}
              >
                Explore map
              </button>
              <button
                type="button"
                className={`dash-map-view-tab ${mapViewMode === 'tutor' ? 'dash-map-view-tab-active' : ''}`}
                role="tab"
                aria-selected={mapViewMode === 'tutor'}
                onClick={() => setMapViewMode('tutor')}
              >
                Ask Tutor
              </button>
              <button
                type="button"
                className={`dash-map-view-tab ${mapViewMode === 'resources' ? 'dash-map-view-tab-active' : ''}`}
                role="tab"
                aria-selected={mapViewMode === 'resources'}
                onClick={() => setMapViewMode('resources')}
              >
                Resources
              </button>
            </div>
          ) : null}

          {!activeMapTopic ? (
            <p className="lead" style={{ margin: 0 }}>
              Select a topic from the Home tab to open its chain map.
            </p>
          ) : chainLoading ? (
            <p className="lead" style={{ margin: 0 }}>
              Loading map...
            </p>
          ) : chainError ? (
            <p className="err" style={{ margin: 0 }}>
              {chainError}
            </p>
          ) : !chainData || chainData.nodes.length === 0 ? (
            <p className="lead" style={{ margin: 0 }}>
              No dependency chain found for this topic.
            </p>
          ) : (
            <>
              {mapViewMode === 'map' ? (
                <div className="dash-map-wrap">
                  <svg
                    ref={mapSvgRef}
                    className="dash-map-canvas"
                    viewBox={`0 0 ${chainLayout?.width ?? 920} ${chainLayout?.height ?? 420}`}
                    role="img"
                    aria-label="Topic dependency map"
                    onPointerMove={handleMapPointerMove}
                    onPointerUp={handleMapPointerUp}
                    onPointerCancel={handleMapPointerUp}
                  >
                    <defs>
                      <marker id="dash-map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#6f8fb8" />
                      </marker>
                    </defs>
                    {edgeRenderData.map(item => {
                      return (
                        <g key={item.edge.id}>
                          <path
                            d={item.path}
                            fill="none"
                            stroke="#5f7390"
                            strokeOpacity="0.55"
                            strokeWidth="1.4"
                            markerEnd="url(#dash-map-arrow)"
                          />
                        </g>
                      )
                    })}

                    {chainLayout?.nodes.map(node => {
                      const isFocus = node.kind === 'focus'
                      const titleLines = wrapTextByWords(node.name, 30, 3)
                      const subjectY = Math.min(MAP_NODE_HEIGHT - 10, 18 + titleLines.length * 12 + 7)
                      const fill =
                        node.kind === 'focus'
                          ? '#25467a'
                          : node.kind === 'upstream'
                            ? '#22423b'
                            : '#3e3447'
                      const stroke =
                        node.kind === 'focus'
                          ? '#8db7ff'
                          : node.kind === 'upstream'
                            ? '#7ed7c4'
                            : '#c89bf6'
                      return (
                        <g
                          key={node.key}
                          transform={`translate(${node.x - MAP_NODE_HALF_WIDTH}, ${node.y - MAP_NODE_HALF_HEIGHT})`}
                          className={`dash-map-node ${selectedTutorNodeKey === node.key ? 'dash-map-node-active' : ''}`}
                          onPointerDown={event => handleMapNodePointerDown(event, node)}
                          onClick={() => {
                            if (suppressClickNodeRef.current === node.key) {
                              suppressClickNodeRef.current = null
                              return
                            }
                            setSelectedTutorNodeKey(node.key)
                            setTutorError(null)
                          }}
                        >
                          <rect
                            width={MAP_NODE_WIDTH}
                            height={MAP_NODE_HEIGHT}
                            rx="10"
                            fill={fill}
                            stroke={stroke}
                            strokeWidth={isFocus ? 2 : 1.2}
                          />
                          <text x="10" y="18" fill="#e8edf5" fontSize="12" fontWeight="700">
                            {titleLines.map((line, index) => (
                              <tspan key={`${node.key}-title-${index}`} x="10" dy={index === 0 ? 0 : 12}>
                                {line}
                              </tspan>
                            ))}
                          </text>
                          <text x="10" y={subjectY} fill="#a8b5c8" fontSize="10">
                            {node.subject ?? 'Uncategorized'}
                          </text>
                          <g
                            className="dash-map-node-chat-btn"
                            transform={`translate(${MAP_NODE_WIDTH - 26}, 6)`}
                            onPointerDown={event => {
                              event.stopPropagation()
                            }}
                            onClick={event => {
                              event.stopPropagation()
                              openTutorForNode(node.key)
                            }}
                          >
                            <rect x="0" y="0" width="18" height="18" rx="9" fill="#122138" stroke="#4f7fca" strokeWidth="1" />
                            <path
                              d="M5.5 5.8 h7 a1.3 1.3 0 0 1 1.3 1.3 v3.5 a1.3 1.3 0 0 1-1.3 1.3 h-3.8 l-2.2 1.9 v-1.9 h-1a1.3 1.3 0 0 1-1.3-1.3 V7.1 a1.3 1.3 0 0 1 1.3-1.3 z"
                              fill="#a7ccff"
                            />
                          </g>
                        </g>
                      )
                    })}

                    {edgeRenderData.map(item => {
                      return (
                        <g key={`${item.edge.id}-label`} className="dash-map-edge-label">
                          <rect
                            x={item.labelX - item.labelWidth / 2}
                            y={item.labelY - 10}
                            width={item.labelWidth}
                            height={18}
                            rx="6"
                            fill="#0e1624"
                            fillOpacity="0.9"
                            stroke="#31435e"
                            strokeWidth="0.8"
                          />
                          <text
                            x={item.labelX}
                            y={item.labelY + 2}
                            textAnchor="middle"
                            fill="#c4d3ea"
                            fontSize="10"
                            fontWeight="600"
                          >
                            {item.label}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                </div>
              ) : mapViewMode === 'tutor' ? (
                <section className="dash-tutor-tab">
                  <aside className="dash-tutor-panel">
                  <div className="dash-tutor-head">
                    <div>
                      <h3>Tutor</h3>
                      <p className="dash-tutor-subhead">Ask questions and learn one step at a time.</p>
                    </div>
                    <div className="dash-tutor-head-actions">
                      <button
                        type="button"
                        className="dash-reset-btn dash-tutor-open-map-btn"
                        onClick={() => setMapViewMode('map')}
                      >
                        Back to map
                      </button>
                    </div>
                  </div>
                  {!selectedTutorNode ? (
                    <p className="dash-long-range-note" style={{ margin: 0 }}>
                      Pick a node in Explore map and tap its chat icon to start tutoring for that concept.
                    </p>
                  ) : (
                    <>
                      <div className="dash-tutor-context">
                        <h4>{selectedTutorNode.name}</h4>
                        <p>
                          {selectedTutorNode.subject ?? 'Uncategorized'} - {selectedTutorNode.kind}
                        </p>
                        <div className="dash-tutor-context-chips">
                          <span>{tutorContext.upstream.length} prerequisites</span>
                          <span>{tutorContext.downstream.length} downstream</span>
                          <span>{tutorContext.relatedEdges.length} linked relations</span>
                        </div>
                      </div>

                      <div className="dash-tutor-chat" ref={tutorChatScrollRef}>
                        {tutorMessages.length === 0 ? (
                          <div className="dash-tutor-empty-state">
                            <p className="dash-long-range-note" style={{ margin: 0 }}>
                              Ask anything about this concept. Tutor will use the map relationships to guide you.
                            </p>
                          </div>
                        ) : (
                          tutorMessages.map(message => {
                            return (
                            <div
                              key={message.id}
                              className={`dash-tutor-bubble-row ${message.role === 'assistant' ? 'dash-tutor-bubble-row-assistant' : 'dash-tutor-bubble-row-user'}`}
                            >
                              <span className="dash-tutor-avatar">{message.role === 'assistant' ? 'T' : 'Y'}</span>
                              <div
                                className={`dash-tutor-bubble ${message.role === 'assistant' ? 'dash-tutor-bubble-assistant' : 'dash-tutor-bubble-user'}`}
                              >
                                <strong>{message.role === 'assistant' ? 'Tutor' : 'You'}</strong>
                                <p>{message.content}</p>
                              </div>
                            </div>
                            )
                          })
                        )}
                        {tutorLoading ? <p className="dash-long-range-note">Tutor is thinking...</p> : null}
                      </div>

                      {tutorQuickPrompts.length > 0 ? (
                        <div className="dash-tutor-composer-suggestions">
                          <p className="dash-tutor-followup-label">Suggested questions</p>
                          <div className="dash-tutor-quick-actions dash-tutor-quick-actions-inline" aria-label="Suggested questions">
                            {tutorQuickPrompts.map(prompt => (
                              <button
                                key={prompt}
                                type="button"
                                className="dash-tutor-quick-btn"
                                disabled={tutorLoading}
                                onClick={() => applySuggestedPromptToInput(prompt)}
                              >
                                {prompt}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <form
                        className="dash-tutor-input-row"
                        onSubmit={event => {
                          event.preventDefault()
                          void sendTutorMessage(tutorInput)
                        }}
                      >
                        <textarea
                          ref={tutorInputRef}
                          value={tutorInput}
                          onChange={event => setTutorInput(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              if (!tutorLoading && tutorInput.trim()) {
                                void sendTutorMessage(tutorInput)
                              }
                            }
                          }}
                          placeholder={`Ask Tutor about ${selectedTutorNode.name}`}
                          disabled={tutorLoading}
                          rows={3}
                        />
                        <button type="submit" className="dash-reset-btn" disabled={tutorLoading || !tutorInput.trim()}>
                          Send
                        </button>
                      </form>
                      <p className="dash-tutor-input-hint">Press Enter to send, Shift+Enter for a new line.</p>
                      <div className="dash-tutor-footer-actions">
                        <button
                          type="button"
                          className="dash-reset-btn dash-tutor-open-map-btn"
                          onClick={() => openTopicInMapTabs({ title: selectedTutorNode.name, subject: selectedTutorNode.subject })}
                        >
                          Open as map tab
                        </button>
                        <button
                          type="button"
                          className="dash-reset-btn dash-tutor-open-map-btn"
                          onClick={clearTutorThread}
                          disabled={!tutorThreadKey || tutorMessages.length === 0}
                        >
                          Clear chat
                        </button>
                      </div>
                      <div className="dash-topic-resource-share-row">
                        <input
                          type="email"
                          placeholder="Share this chat with email"
                          value={tutorShareEmail}
                          onChange={event => setTutorShareEmail(event.target.value)}
                          disabled={tutorLoading}
                        />
                        <button
                          type="button"
                          className="dash-reset-btn"
                          onClick={() => {
                            void shareTutorEpisode()
                          }}
                          disabled={tutorLoading || !tutorShareEmail.trim()}
                        >
                          Share chat
                        </button>
                      </div>
                      {tutorError ? (
                        <p className="err" style={{ margin: 0 }}>
                          {tutorError}
                        </p>
                      ) : null}
                    </>
                  )}
                  </aside>
                </section>
              ) : (
                <section className="card dash-res">
                  <header className="dash-res-header">
                    <h3 className="dash-res-title">Resources</h3>
                    <span className="dash-res-subtitle">for {activeMapTopic?.title}</span>
                  </header>

                  {/* ── Add resource: segmented picker ── */}
                  <div className="dash-res-add">
                    <div className="dash-res-segmented" role="radiogroup" aria-label="Resource type">
                      {(['file', 'link', 'note'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={resourceAddMode === mode}
                          className={`dash-res-seg-btn ${resourceAddMode === mode ? 'dash-res-seg-active' : ''}`}
                          onClick={() => setResourceAddMode(mode)}
                        >
                          <span className={`dash-res-type-icon dash-res-type-${mode}`}>
                            {mode === 'file' ? '\u{1F4CE}' : mode === 'link' ? '\u{1F517}' : '\u{270F}\u{FE0F}'}
                          </span>
                          {mode === 'file' ? 'File' : mode === 'link' ? 'Link' : 'Note'}
                        </button>
                      ))}
                    </div>

                    {resourceAddMode === 'file' && (
                      <div className="dash-res-input-row">
                        <input
                          type="text"
                          className="dash-res-label-input"
                          placeholder="Label (optional)"
                          value={resourceLabelDraft}
                          onChange={event => setResourceLabelDraft(event.target.value)}
                          disabled={resourceActionLoading}
                        />
                        <button
                          type="button"
                          className="dash-res-add-btn"
                          onClick={() => resourceFileInputRef.current?.click()}
                          disabled={resourceActionLoading}
                        >
                          Choose file
                        </button>
                        <input
                          ref={resourceFileInputRef}
                          type="file"
                          className="dash-topic-resource-file-input"
                          onChange={event => {
                            const file = event.target.files?.[0]
                            if (file) void uploadTopicFile(file)
                          }}
                          disabled={resourceActionLoading}
                        />
                      </div>
                    )}

                    {resourceAddMode === 'link' && (
                      <div className="dash-res-input-row">
                        <input
                          type="text"
                          className="dash-res-label-input"
                          placeholder="Label (optional)"
                          value={resourceLabelDraft}
                          onChange={event => setResourceLabelDraft(event.target.value)}
                          disabled={resourceActionLoading}
                        />
                        <input
                          type="url"
                          className="dash-res-url-input"
                          placeholder="https://example.com/resource"
                          value={resourceUrlDraft}
                          onChange={event => setResourceUrlDraft(event.target.value)}
                          disabled={resourceActionLoading}
                        />
                        <button
                          type="button"
                          className="dash-res-add-btn"
                          onClick={() => void addTopicUrl()}
                          disabled={resourceActionLoading || !resourceUrlDraft.trim()}
                        >
                          Add
                        </button>
                      </div>
                    )}

                    {resourceAddMode === 'note' && (
                      <div className="dash-res-input-col">
                        <input
                          type="text"
                          className="dash-res-label-input"
                          placeholder="Label (optional)"
                          value={resourceLabelDraft}
                          onChange={event => setResourceLabelDraft(event.target.value)}
                          disabled={resourceActionLoading}
                        />
                        <textarea
                          className="dash-res-note-input"
                          placeholder="Write your note..."
                          value={resourceNoteDraft}
                          onChange={event => setResourceNoteDraft(event.target.value)}
                          rows={3}
                          disabled={resourceActionLoading}
                        />
                        <button
                          type="button"
                          className="dash-res-add-btn dash-res-add-btn-end"
                          onClick={() => void addTopicNote()}
                          disabled={resourceActionLoading || !resourceNoteDraft.trim()}
                        >
                          Save note
                        </button>
                      </div>
                    )}
                  </div>

                  {resourceError ? (
                    <p className="err" style={{ marginBottom: 0 }}>
                      {resourceError}
                    </p>
                  ) : null}

                  {/* ── Resource list ── */}
                  {topicResourcesLoadingByKey[activeTopicResourceKey ?? ''] ? (
                    <div className="dash-res-empty">Loading resources...</div>
                  ) : activeTopicResources.length === 0 ? (
                    <div className="dash-res-empty">
                      <span className="dash-res-empty-icon">{'\u{1F4DA}'}</span>
                      <p>No resources yet.</p>
                      <p className="dash-res-empty-hint">Upload a file, save a link, or write a note to get started.</p>
                    </div>
                  ) : (
                    <>
                      {activeTopicResources.some(r => r.visibility !== 'shared') && (
                        <div className="dash-res-group">
                          <h4 className="dash-res-group-label">Your resources</h4>
                          <div className="dash-res-list">
                            {activeTopicResources.filter(r => r.visibility !== 'shared').map(resource => (
                              <div key={resource.id} className="dash-res-card" style={{ position: 'relative' }}>
                                <div className={`dash-res-card-badge dash-res-badge-${resource.resource_type}`}>
                                  {resource.resource_type === 'file' ? '\u{1F4CE}' : resource.resource_type === 'url' ? '\u{1F517}' : '\u{1F4DD}'}
                                </div>
                                <div className="dash-res-card-body">
                                  <div className="dash-res-card-title">{resource.label || resource.file_name || resource.url || 'Resource'}</div>
                                  <div className="dash-res-card-meta">
                                    {resource.resource_type === 'file' ? 'File' : resource.resource_type === 'url' ? 'Link' : 'Note'}
                                    {' \u00B7 '}
                                    {new Date(resource.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                  </div>
                                  {resource.resource_type === 'note' && resource.note_content ? (
                                    <p className="dash-res-card-note">{resource.note_content}</p>
                                  ) : null}
                                </div>
                                <div className="dash-res-card-actions">
                                  {resource.open_url ? (
                                    <a href={resource.open_url} target="_blank" rel="noreferrer" className="dash-res-icon-btn" title="Open">
                                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8A1.5 1.5 0 0 0 13 12.5V10m-3-8h4v4m0-4L7.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    </a>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="dash-res-icon-btn"
                                    title="Share"
                                    onClick={() => {
                                      if (resourceShareMenuId === resource.id) {
                                        setResourceShareMenuId(null)
                                        return
                                      }
                                      setResourceShareMenuId(resource.id)
                                      void ensureShareUsersLoaded()
                                    }}
                                    disabled={resourceActionLoading}
                                  >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="12" cy="3" r="2" stroke="currentColor" strokeWidth="1.3"/><circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="13" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M5.7 6.9 10.3 4.1M5.7 9.1l4.6 2.8" stroke="currentColor" strokeWidth="1.3"/></svg>
                                  </button>
                                  <button
                                    type="button"
                                    className="dash-res-icon-btn dash-res-icon-btn-danger"
                                    title="Remove"
                                    onClick={() => void removeTopicResource(resource.id)}
                                    disabled={resourceActionLoading}
                                  >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.3 4V2.7a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1V4m1.6 0-.5 8.5a1.5 1.5 0 0 1-1.5 1.4H5.7a1.5 1.5 0 0 1-1.5-1.4L3.7 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                  </button>
                                </div>

                                {resourceShareMenuId === resource.id ? (
                                  <div className="dash-res-share-popover" ref={sharePopoverRef}>
                                    <div className="dash-res-share-popover-head">Share with</div>
                                    {shareUsersLoading ? (
                                      <div className="dash-res-share-popover-loading">Loading users...</div>
                                    ) : (
                                      <div className="dash-res-share-popover-list">
                                        {shareUsers.filter(u => u.status !== 'you' && u.userId).map(user => (
                                          <button
                                            key={user.userId}
                                            type="button"
                                            className="dash-res-share-user-btn"
                                            onClick={() => void shareTopicResource(resource.id, user.userId!)}
                                            disabled={resourceActionLoading}
                                          >
                                            <span className="dash-res-share-avatar">{user.displayName.charAt(0).toUpperCase()}</span>
                                            <span className="dash-res-share-user-info">
                                              <span className="dash-res-share-user-name">{user.displayName}</span>
                                              <span className="dash-res-share-user-email">{user.email}</span>
                                            </span>
                                          </button>
                                        ))}
                                        {shareUsers.filter(u => u.status !== 'you' && u.userId).length === 0 && (
                                          <div className="dash-res-share-popover-loading">No users to share with</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {activeTopicResources.some(r => r.visibility === 'shared') && (
                        <div className="dash-res-group">
                          <h4 className="dash-res-group-label">Shared with you</h4>
                          <div className="dash-res-list">
                            {activeTopicResources.filter(r => r.visibility === 'shared').map(resource => (
                              <div key={resource.id} className="dash-res-card">
                                <div className={`dash-res-card-badge dash-res-badge-${resource.resource_type}`}>
                                  {resource.resource_type === 'file' ? '\u{1F4CE}' : resource.resource_type === 'url' ? '\u{1F517}' : '\u{1F4DD}'}
                                </div>
                                <div className="dash-res-card-body">
                                  <div className="dash-res-card-title">{resource.label || resource.file_name || resource.url || 'Resource'}</div>
                                  <div className="dash-res-card-meta">
                                    {resource.resource_type === 'file' ? 'File' : resource.resource_type === 'url' ? 'Link' : 'Note'}
                                    {' \u00B7 '}
                                    {new Date(resource.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                  </div>
                                  {resource.resource_type === 'note' && resource.note_content ? (
                                    <p className="dash-res-card-note">{resource.note_content}</p>
                                  ) : null}
                                </div>
                                <div className="dash-res-card-actions">
                                  {resource.open_url ? (
                                    <a href={resource.open_url} target="_blank" rel="noreferrer" className="dash-res-icon-btn" title="Open">
                                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8A1.5 1.5 0 0 0 13 12.5V10m-3-8h4v4m0-4L7.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </section>
      </section>
    )
  }

  return (
    <main className="dash-page">
      <h1>Weekly learning timeline</h1>
      <p className="lead">
        Subjects and active topics on a timescale. This is a UI-first version with sample data to
        tune layout before backend wiring.
      </p>

      <div className="dash-tab-row">
        <button
          type="button"
          className={`dash-tab ${activeTab === 'home' ? 'dash-tab-active' : ''}`}
          onClick={() => setActiveTab('home')}
        >
          Home
        </button>
        <button
          type="button"
          className={`dash-tab ${activeTab === 'map' ? 'dash-tab-active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          Map
        </button>
      </div>

      {activeTab === 'home' ? renderHomeTab() : renderMapTab()}
    </main>
  )
}
