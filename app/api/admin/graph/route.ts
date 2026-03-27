import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Concept, ConceptConnection } from '@/lib/graph/types'

export const runtime = 'nodejs'

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

    const supabase = createServiceClient()

    const [{ data: conceptRows, error: conceptError }, { data: connectionRows, error: connectionError }] =
      await Promise.all([
        supabase.from('concepts').select('*').order('subject').order('name').limit(600),
        supabase
          .from('concept_connections')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(900),
      ])

    if (conceptError) {
      return NextResponse.json({ error: conceptError.message }, { status: 500 })
    }
    if (connectionError) {
      return NextResponse.json({ error: connectionError.message }, { status: 500 })
    }

    const allConcepts = (conceptRows ?? []) as Concept[]
    const allConnections = (connectionRows ?? []) as ConceptConnection[]

    const filteredConnections = allConnections.filter(connection =>
      connectionVisible(connection, { subject, search, source })
    )

    const conceptIndex = new Map(allConcepts.map(concept => [conceptKey(concept.name, concept.subject), concept]))
    const visibleConceptMap = new Map<string, Concept>()

    for (const concept of allConcepts) {
      if (conceptVisible(concept, { subject, grade, search })) {
        visibleConceptMap.set(conceptKey(concept.name, concept.subject), concept)
      }
    }

    for (const connection of filteredConnections) {
      const aKey = conceptKey(connection.concept_a, connection.subject_a)
      const bKey = conceptKey(connection.concept_b, connection.subject_b)

      const a = conceptIndex.get(aKey)
      if (a && (!grade || a.grade === grade || a.grade === null)) {
        visibleConceptMap.set(aKey, a)
      }

      const b = conceptIndex.get(bKey)
      if (b && (!grade || b.grade === grade || b.grade === null)) {
        visibleConceptMap.set(bKey, b)
      }

      if (!a && (!subject || connection.subject_a === subject)) {
        visibleConceptMap.set(aKey, {
          id: `synthetic:${aKey}`,
          name: connection.concept_a,
          subject: connection.subject_a,
          type: 'topic_concept',
          grade: grade || null,
          created_at: connection.created_at,
        })
      }

      if (!b && (!subject || connection.subject_b === subject)) {
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

    const visibleConceptKeys = new Set(visibleConceptMap.keys())
    const concepts = Array.from(visibleConceptMap.values()).slice(0, 220)
    const allowedConceptKeys = new Set(concepts.map(concept => conceptKey(concept.name, concept.subject)))

    const connections = filteredConnections
      .filter(connection => {
        const aKey = conceptKey(connection.concept_a, connection.subject_a)
        const bKey = conceptKey(connection.concept_b, connection.subject_b)
        return allowedConceptKeys.has(aKey) && allowedConceptKeys.has(bKey)
      })
      .slice(0, 320)

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

    return NextResponse.json({
      concepts,
      connections,
      filters: { subject, grade, search, source },
      options: { subjects, grades },
      stats: {
        totalConcepts: concepts.length,
        totalConnections: connections.length,
        curriculumConnections: connections.filter(connection => connection.child_key === 'curriculum').length,
        studentConnections: connections.filter(connection => connection.child_key !== 'curriculum').length,
        visibleSubjects: Array.from(
          new Set(concepts.map(concept => concept.subject).filter((value): value is string => Boolean(value)))
        ).length,
        trimmedConcepts: visibleConceptKeys.size > concepts.length,
        trimmedConnections: filteredConnections.length > connections.length,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
