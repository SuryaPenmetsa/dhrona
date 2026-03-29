import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

type ConnectionRow = {
  id: string
  concept_a: string
  concept_b: string
  subject_a: string | null
  subject_b: string | null
  relationship: string
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

function conceptKey(name: string, subject: string | null) {
  return `${name}@@${subject ?? ''}`
}

function parseKey(key: string) {
  const idx = key.lastIndexOf('@@')
  if (idx === -1) {
    return { name: key, subject: null as string | null }
  }
  const name = key.slice(0, idx)
  const subject = key.slice(idx + 2) || null
  return { name, subject }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const topic = searchParams.get('topic')?.trim()
    const subject = searchParams.get('subject')?.trim() || null

    if (!topic) {
      return NextResponse.json({ error: 'Missing topic parameter' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Single query for all curriculum connections — avoids multiple sequential
    // round-trips to Seoul DB (each adding ~100-150ms network latency).
    // BFS traversal runs in-memory which is sub-millisecond.
    const { data, error } = await supabase
      .from('concept_connections')
      .select('id, concept_a, concept_b, subject_a, subject_b, relationship')
      .eq('child_key', 'curriculum')

    if (error) throw new Error(error.message)

    const rows = (data ?? []) as ConnectionRow[]
    const outgoing = new Map<string, ChainEdge[]>()
    const incoming = new Map<string, ChainEdge[]>()
    const allNodeKeys = new Set<string>()
    const allEdges: ChainEdge[] = []

    for (const row of rows) {
      const fromKey = conceptKey(row.concept_a, row.subject_a)
      const toKey = conceptKey(row.concept_b, row.subject_b)
      const edge: ChainEdge = { id: row.id, fromKey, toKey, relationship: row.relationship }
      allEdges.push(edge)
      allNodeKeys.add(fromKey)
      allNodeKeys.add(toKey)
      if (!outgoing.has(fromKey)) outgoing.set(fromKey, [])
      if (!incoming.has(toKey)) incoming.set(toKey, [])
      outgoing.get(fromKey)!.push(edge)
      incoming.get(toKey)!.push(edge)
    }

    const topicMatches = Array.from(allNodeKeys).filter(key => {
      const parsed = parseKey(key)
      if (parsed.name !== topic) return false
      if (subject && parsed.subject && parsed.subject !== subject) return false
      return true
    })

    const focusKey = topicMatches[0] ?? conceptKey(topic, subject)
    const maxDepth = 3
    const included = new Set<string>([focusKey])
    const depthByKey = new Map<string, number>([[focusKey, 0]])

    const backwardQueue = [{ key: focusKey, depth: 0 }]
    while (backwardQueue.length) {
      const current = backwardQueue.shift()!
      if (Math.abs(current.depth) >= maxDepth) continue
      for (const edge of incoming.get(current.key) ?? []) {
        const nextDepth = current.depth - 1
        const prevDepth = depthByKey.get(edge.fromKey)
        if (prevDepth === undefined || Math.abs(nextDepth) < Math.abs(prevDepth)) {
          depthByKey.set(edge.fromKey, nextDepth)
        }
        if (!included.has(edge.fromKey)) {
          included.add(edge.fromKey)
          backwardQueue.push({ key: edge.fromKey, depth: nextDepth })
        }
      }
    }

    const forwardQueue = [{ key: focusKey, depth: 0 }]
    while (forwardQueue.length) {
      const current = forwardQueue.shift()!
      if (Math.abs(current.depth) >= maxDepth) continue
      for (const edge of outgoing.get(current.key) ?? []) {
        const nextDepth = current.depth + 1
        const prevDepth = depthByKey.get(edge.toKey)
        if (prevDepth === undefined || Math.abs(nextDepth) < Math.abs(prevDepth)) {
          depthByKey.set(edge.toKey, nextDepth)
        }
        if (!included.has(edge.toKey)) {
          included.add(edge.toKey)
          forwardQueue.push({ key: edge.toKey, depth: nextDepth })
        }
      }
    }

    const nodes: ChainNode[] = Array.from(included).map(key => {
      const parsed = parseKey(key)
      const depth = depthByKey.get(key) ?? 0
      return {
        key,
        name: parsed.name,
        subject: parsed.subject,
        depth,
        kind: depth === 0 ? 'focus' : depth < 0 ? 'upstream' : 'downstream',
      }
    })

    const edges = allEdges.filter(edge => included.has(edge.fromKey) && included.has(edge.toKey))

    return NextResponse.json({
      topic,
      subject,
      focusKey,
      nodes,
      edges,
    }, {
      headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=300' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
