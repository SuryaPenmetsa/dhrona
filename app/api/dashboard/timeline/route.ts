import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  buildSubjectsFromNames,
  buildTopicSlots,
  getTimelineBounds,
  toSubjectId,
  weekdayIndexFromIso,
  type TopicSlot,
} from '@/lib/dashboard/timeline'

type ScheduleRow = {
  id: string
  concept_name: string
  subject: string
  week_start: string
  week_end: string
  schedule_type: 'current' | 'coming'
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('start_date')
  const endDate = searchParams.get('end_date')
  const subjectId = searchParams.get('subject_id')
  const search = searchParams.get('search')?.trim() ?? ''

  try {
    const fallbackSlots = buildTopicSlots()
    const { minDate: fallbackMinDate, maxDate: fallbackMaxDate } = getTimelineBounds(fallbackSlots)

    const supabase = createServiceClient()

    // Build the data query — if dates are provided, use them directly;
    // otherwise omit date filters (equivalent to full range).
    // This avoids a sequential metadata query just to get default bounds.
    let query = supabase
      .from('curriculum_schedule')
      .select('id, concept_name, subject, week_start, week_end, schedule_type')
      .order('week_start')
      .order('concept_name')

    if (startDate && endDate) {
      const orderedPair = startDate <= endDate ? [startDate, endDate] : [endDate, startDate]
      query = query.lte('week_start', orderedPair[1]).gte('week_end', orderedPair[0])
    } else if (startDate) {
      query = query.gte('week_end', startDate)
    } else if (endDate) {
      query = query.lte('week_start', endDate)
    }

    // Resolve subject filter name from ID (build mapping from fallback data initially)
    // We'll refine after we have actual subjects from the DB
    let selectedSubjectName: string | null = null

    let weekQuery = supabase
      .from('curriculum_schedule')
      .select('subject, week_start, week_end')
      .order('week_start', { ascending: true })
      .order('week_end', { ascending: true })

    if (search) {
      query = query.ilike('concept_name', `%${search}%`)
    }

    // Single parallel batch: data query + full metadata (subjects + week bounds)
    const [{ data: rows, error: rowsError }, { data: metaWeekRows, error: metaWeeksError }] = await Promise.all([
      query,
      weekQuery,
    ])
    if (rowsError) throw new Error(rowsError.message)
    if (metaWeeksError) throw new Error(metaWeeksError.message)

    // Derive subjects and date bounds from metadata rows (replaces 3 separate queries)
    let dbMinDate = fallbackMinDate
    let dbMaxDate = fallbackMaxDate
    const subjectSet = new Set<string>()
    for (const row of metaWeekRows ?? []) {
      if (row.subject) subjectSet.add(row.subject)
      if (row.week_start && row.week_start < dbMinDate) dbMinDate = row.week_start
      if (row.week_end && row.week_end > dbMaxDate) dbMaxDate = row.week_end
    }

    const effectiveStart = startDate ?? dbMinDate
    const effectiveEnd = endDate ?? dbMaxDate
    const orderedStart = effectiveStart <= effectiveEnd ? effectiveStart : effectiveEnd
    const orderedEnd = effectiveStart <= effectiveEnd ? effectiveEnd : effectiveStart

    const allSubjects = buildSubjectsFromNames(Array.from(subjectSet).sort())
    const subjectNameById = new Map(allSubjects.map(subject => [subject.id, subject.name]))
    selectedSubjectName = subjectId && subjectId !== 'all' ? subjectNameById.get(subjectId) ?? null : null

    // Deduplicate weeks, applying subject filter if selected
    const weeks = Array.from(
      new Map(
        (metaWeekRows ?? [])
          .filter(
            (row): row is { subject: string; week_start: string; week_end: string } =>
              Boolean(row.week_start) && Boolean(row.week_end)
          )
          .filter(row => !selectedSubjectName || row.subject === selectedSubjectName)
          .map(row => [`${row.week_start}|${row.week_end}`, { week_start: row.week_start, week_end: row.week_end }] as const)
      ).values()
    )

    // Apply subject filter in-memory on the already-fetched rows
    const filteredRows = selectedSubjectName
      ? ((rows ?? []) as ScheduleRow[]).filter(row => row.subject === selectedSubjectName)
      : ((rows ?? []) as ScheduleRow[])

    const topicSlots: TopicSlot[] = filteredRows.map((row, index) => {
      const subjectSafe = row.subject ?? 'Unknown'
      const startDay = weekdayIndexFromIso(row.week_start)
      const endDay = weekdayIndexFromIso(row.week_end)
      const clampedEndDay = endDay < startDay ? startDay : endDay
      return {
        id: row.id,
        subjectId: toSubjectId(subjectSafe),
        title: row.concept_name,
        teacher: row.schedule_type === 'current' ? 'Current syllabus' : 'Upcoming syllabus',
        scheduleType: row.schedule_type,
        weekIndex: index,
        startDay,
        endDay: clampedEndDay,
        startTime: '',
        endTime: '',
        startDate: row.week_start,
        endDate: row.week_end,
      }
    })

    const activeSubjectIds = new Set(topicSlots.map(slot => slot.subjectId))
    const visibleSubjects =
      subjectId && subjectId !== 'all'
        ? allSubjects.filter(subject => subject.id === subjectId)
        : allSubjects.filter(subject => activeSubjectIds.has(subject.id))

    return NextResponse.json({
      filters: {
        startDate: orderedStart,
        endDate: orderedEnd,
        subjectId: subjectId ?? 'all',
        minDate: dbMinDate,
        maxDate: dbMaxDate,
      },
      subjects: visibleSubjects,
      allSubjects,
      weeks,
      topicSlots,
    }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
