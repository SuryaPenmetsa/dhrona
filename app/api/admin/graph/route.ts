import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Concept, ConceptConnection } from '@/lib/graph/types'

export const runtime = 'nodejs'
const PAGE_SIZE = 1000

type GraphSource = 'all' | 'curriculum' | 'student'

function checkAdmin(request: Request): boolean {
  const secret = process.env.WTR_ADMIN_SECRET
  if (!secret) return true
  return request.headers.get('x-admin-secret') === secret
}

function matchesSearch(value: string | null | undefined, search: string): boolean {
  if (!search) return true
  return (value ?? '').toLowerCase().includes(search)
}

function conceptVisible(concept: Concept, filters: { subject: string; grade: string; search: string }) {
  const subjectOk = !filters.subject || (concept.subject ?? '') === filters.subject
  const gradeOk = !filters.grade || concept.grade === filters.grade || concept.grade === null
  const searchOk =
    !filters.search ||
    matchesSearch(concept.name, filters.search) ||
    matchesSearch(concept.subject, filters.search) ||
    matchesSearch(concept.type, filters.search)

  return subjectOk && gradeOk && searchOk
}

function connectionVisible(
  connection: ConceptConnection,
  filters: { subject: string; search: string; source: GraphSource }
) {
  const sourceOk =
    filters.source === 'all' ||
    (filters.source === 'curriculum' && connection.child_key === 'curriculum') ||
    (filters.source === 'student' && connection.child_key !== 'curriculum')

  const subjectOk =
    !filters.subject ||
    connection.subject_a === filters.subject ||
    connection.subject_b === filters.subject

  const searchOk =
    !filters.search ||
    matchesSearch(connection.concept_a, filters.search) ||
    matchesSearch(connection.concept_b, filters.search) ||
    matchesSearch(connection.relationship, filters.search) ||
    matchesSearch(connection.subject_a, filters.search) ||
    matchesSearch(connection.subject_b, filters.search)

  return sourceOk && subjectOk && searchOk
}

function conceptKey(name: string, subject: string | null) {
  return `${name}::${subject ?? ''}`
}

async function fetchAllConcepts(supabase: ReturnType<typeof createServiceClient>) {
  const rows: Concept[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('concepts')
      .select('*')
      .order('subject')
      .order('name')
      .order('id')
      .range(from, to)

    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as Concept[]))
    if (!data || data.length < PAGE_SIZE) break
  }

  return rows
}

async function fetchAllConnections(supabase: ReturnType<typeof createServiceClient>) {
  const rows: ConceptConnection[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('concept_connections')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as ConceptConnection[]))
    if (!data || data.length < PAGE_SIZE) break
  }

  return rows
}

export async function GET(request: Request) {
  try {
    if (!checkAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const subject = url.searchParams.get('subject')?.trim() ?? ''
    const grade = url.searchParams.get('grade')?.trim() ?? ''
    const search = url.searchParams.get('search')?.trim().toLowerCase() ?? ''
    const source = (url.searchParams.get('source')?.trim() ?? 'all') as GraphSource

    const weekStart = url.searchParams.get('week_start')?.trim() ?? ''
    const weekEnd = url.searchParams.get('week_end')?.trim() ?? ''

    const supabase = createServiceClient()

    const [allConcepts, allConnections, { data: allSchedule }, { data: weekOptions }] = await Promise.all([
      fetchAllConcepts(supabase),
      fetchAllConnections(supabase),
      supabase
        .from('curriculum_schedule')
        .select('concept_name, subject, week_start, week_end, schedule_type')
        .order('week_start'),
      supabase
        .from('curriculum_schedule')
        .select('week_start, week_end')
        .order('week_start'),
    ])

    const schedule = allSchedule ?? []

    // Build a set of concept keys that fall within the selected week range
    const weekFilteredKeys = new Set<string>()
    let weekFiltering = false
    if (weekStart || weekEnd) {
      weekFiltering = true
      for (const s of schedule) {
        const inRange =
          (!weekStart || s.week_start >= weekStart) &&
          (!weekEnd || s.week_end <= weekEnd)
        if (inRange) {
          weekFilteredKeys.add(conceptKey(s.concept_name, s.subject))
        }
      }
    }

    // Build schedule lookup: concept key → earliest week_start
    const scheduleByKey = new Map<string, { week_start: string; week_end: string; schedule_type: string }>()
    for (const s of schedule) {
      const key = conceptKey(s.concept_name, s.subject)
      if (!scheduleByKey.has(key)) {
        scheduleByKey.set(key, s)
      }
    }

    // Deduplicate week options
    const seenWeeks = new Set<string>()
    const weeks = (weekOptions ?? [])
      .filter(w => {
        const k = `${w.week_start}|${w.week_end}`
        if (seenWeeks.has(k)) return false
        seenWeeks.add(k)
        return true
      })

    const filteredConnections = allConnections
      .filter(connection => connectionVisible(connection, { subject, search, source }))
      .filter(connection => {
        if (!weekFiltering) return true
        const aKey = conceptKey(connection.concept_a, connection.subject_a)
        const bKey = conceptKey(connection.concept_b, connection.subject_b)
        return weekFilteredKeys.has(aKey) && weekFilteredKeys.has(bKey)
      })

    const conceptIndex = new Map(allConcepts.map(concept => [conceptKey(concept.name, concept.subject), concept]))
    const visibleConceptMap = new Map<string, Concept>()

    for (const concept of allConcepts) {
      if (conceptVisible(concept, { subject, grade, search })) {
        const key = conceptKey(concept.name, concept.subject)
        if (weekFiltering && !weekFilteredKeys.has(key)) continue
        visibleConceptMap.set(key, concept)
      }
    }

    for (const connection of filteredConnections) {
      const aKey = conceptKey(connection.concept_a, connection.subject_a)
      const bKey = conceptKey(connection.concept_b, connection.subject_b)

      const a = conceptIndex.get(aKey)
      if (a && (!grade || a.grade === grade || a.grade === null) && (!weekFiltering || weekFilteredKeys.has(aKey))) {
        visibleConceptMap.set(aKey, a)
      }

      const b = conceptIndex.get(bKey)
      if (b && (!grade || b.grade === grade || b.grade === null) && (!weekFiltering || weekFilteredKeys.has(bKey))) {
        visibleConceptMap.set(bKey, b)
      }

      if (!a && (!subject || connection.subject_a === subject) && (!weekFiltering || weekFilteredKeys.has(aKey))) {
        visibleConceptMap.set(aKey, {
          id: `synthetic:${aKey}`,
          name: connection.concept_a,
          subject: connection.subject_a,
          type: 'topic_concept',
          grade: grade || null,
          created_at: connection.created_at,
        })
      }

      if (!b && (!subject || connection.subject_b === subject) && (!weekFiltering || weekFilteredKeys.has(bKey))) {
        visibleConceptMap.set(bKey, {
          id: `synthetic:${bKey}`,
          name: connection.concept_b,
          subject: connection.subject_b,
          type: 'topic_concept',
          grade: grade || null,
          created_at: connection.created_at,
        })
      }
    }

    const concepts = Array.from(visibleConceptMap.values())
    const allowedConceptKeys = new Set(concepts.map(concept => conceptKey(concept.name, concept.subject)))

    const connections = filteredConnections
      .filter(connection => {
        const aKey = conceptKey(connection.concept_a, connection.subject_a)
        const bKey = conceptKey(connection.concept_b, connection.subject_b)
        return allowedConceptKeys.has(aKey) && allowedConceptKeys.has(bKey)
      })

    const subjects = Array.from(
      new Set(
        allConcepts
          .map(concept => concept.subject)
          .filter((value): value is string => Boolean(value))
      )
    ).sort((a, b) => a.localeCompare(b))

    const grades = Array.from(
      new Set(
        allConcepts
          .map(concept => concept.grade)
          .filter((value): value is string => Boolean(value))
      )
    ).sort((a, b) => a.localeCompare(b))

    // Attach schedule info to each concept
    const conceptsWithSchedule = concepts.map(concept => {
      const key = conceptKey(concept.name, concept.subject)
      const sched = scheduleByKey.get(key)
      return {
        ...concept,
        week_start: sched?.week_start ?? null,
        week_end: sched?.week_end ?? null,
        schedule_type: sched?.schedule_type ?? null,
      }
    })

    return NextResponse.json({
      concepts: conceptsWithSchedule,
      connections,
      schedule,
      filters: { subject, grade, search, source, weekStart, weekEnd },
      options: { subjects, grades, weeks },
      stats: {
        totalConcepts: concepts.length,
        totalConnections: connections.length,
        curriculumConnections: connections.filter(connection => connection.child_key === 'curriculum').length,
        studentConnections: connections.filter(connection => connection.child_key !== 'curriculum').length,
        visibleSubjects: Array.from(
          new Set(concepts.map(concept => concept.subject).filter((value): value is string => Boolean(value)))
        ).length,
        trimmedConcepts: false,
        trimmedConnections: false,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
