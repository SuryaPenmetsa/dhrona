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

    const [
      { data: allSubjectsRows, error: subjectError },
      { data: minBoundRow, error: minBoundError },
      { data: maxBoundRow, error: maxBoundError },
    ] = await Promise.all([
      supabase.from('curriculum_schedule').select('subject').order('subject'),
      supabase
        .from('curriculum_schedule')
        .select('week_start')
        .order('week_start', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('curriculum_schedule')
        .select('week_end')
        .order('week_end', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (subjectError || minBoundError || maxBoundError) {
      const message = subjectError?.message ?? minBoundError?.message ?? maxBoundError?.message ?? 'Query failed'
      throw new Error(message)
    }

    const dbMinDate = minBoundRow?.week_start ?? fallbackMinDate
    const dbMaxDate = maxBoundRow?.week_end ?? fallbackMaxDate

    const effectiveStart = startDate ?? dbMinDate
    const effectiveEnd = endDate ?? dbMaxDate
    const orderedStart = effectiveStart <= effectiveEnd ? effectiveStart : effectiveEnd
    const orderedEnd = effectiveStart <= effectiveEnd ? effectiveEnd : effectiveStart

    const subjectNames = Array.from(
      new Set((allSubjectsRows ?? []).map(row => row.subject).filter((v): v is string => Boolean(v)))
    )

    const allSubjects = buildSubjectsFromNames(subjectNames)
    const subjectNameById = new Map(allSubjects.map(subject => [subject.id, subject.name]))
    const selectedSubjectName =
      subjectId && subjectId !== 'all' ? subjectNameById.get(subjectId) ?? null : null

    let query = supabase
      .from('curriculum_schedule')
      .select('id, concept_name, subject, week_start, week_end, schedule_type')
      .lte('week_start', orderedEnd)
      .gte('week_end', orderedStart)
      .order('week_start')
      .order('concept_name')

    if (selectedSubjectName) {
      query = query.eq('subject', selectedSubjectName)
    }
    if (search) {
      query = query.ilike('concept_name', `%${search}%`)
    }

    const { data: rows, error: rowsError } = await query
    if (rowsError) {
      throw new Error(rowsError.message)
    }

    let weekQuery = supabase
      .from('curriculum_schedule')
      .select('week_start, week_end')
      .order('week_start', { ascending: true })
      .order('week_end', { ascending: true })
    if (selectedSubjectName) {
      weekQuery = weekQuery.eq('subject', selectedSubjectName)
    }
    const { data: weekRows, error: weeksError } = await weekQuery
    if (weeksError) {
      throw new Error(weeksError.message)
    }
    const weeks = Array.from(
      new Map(
        (weekRows ?? [])
          .filter(
            (row): row is { week_start: string; week_end: string } =>
              Boolean(row.week_start) && Boolean(row.week_end)
          )
          .map(row => [`${row.week_start}|${row.week_end}`, row] as const)
      ).values()
    )

    const topicSlots: TopicSlot[] = ((rows ?? []) as ScheduleRow[]).map((row, index) => {
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
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
