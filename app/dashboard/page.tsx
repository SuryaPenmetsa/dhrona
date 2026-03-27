'use client'

import { useEffect, useMemo, useState } from 'react'
import DateRangePicker from '@/components/dashboard/DateRangePicker'
import {
  addDaysToIsoDate,
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
  subjects: Subject[]
  allSubjects: Subject[]
  topicSlots: TopicSlot[]
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

type LaidOutSlot = { slot: TopicSlot; lane: number }

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
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatSlotMeta(slot: TopicSlot): string {
  if (slot.startTime && slot.endTime) {
    return `${slot.startTime} - ${slot.endTime} - ${slot.teacher}`
  }
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

export default function DashboardPage() {
  const initialSlots = useMemo(() => buildTopicSlots(), [])
  const { minDate: fallbackMinDate, maxDate: fallbackMaxDate } = useMemo(
    () => getTimelineBounds(initialSlots),
    [initialSlots]
  )

  const [rangeMinDate, setRangeMinDate] = useState(fallbackMinDate)
  const [rangeMaxDate, setRangeMaxDate] = useState(fallbackMaxDate)
  const [startDate, setStartDate] = useState(() => {
    const suggestedStart = addDaysToIsoDate(fallbackMaxDate, -6)
    return suggestedStart < fallbackMinDate ? fallbackMinDate : suggestedStart
  })
  const [endDate, setEndDate] = useState(fallbackMaxDate)
  const [selectedSubjectId, setSelectedSubjectId] = useState('all')

  const [allSubjects, setAllSubjects] = useState<Subject[]>([])
  const [visibleSubjects, setVisibleSubjects] = useState<Subject[]>([])
  const [filteredSlots, setFilteredSlots] = useState<TopicSlot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadFilteredTimeline() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          start_date: startDate,
          end_date: endDate,
          subject_id: selectedSubjectId,
        })
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
  }, [endDate, selectedSubjectId, startDate])

  const selectedDateRangeLabel =
    startDate === endDate
      ? formatDateLabel(startDate)
      : `${formatDateLabel(startDate)} to ${formatDateLabel(endDate)}`

  const sortedSlots = useMemo(() => {
    return [...filteredSlots].sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate)
      if (a.startDay !== b.startDay) return a.startDay - b.startDay
      return a.startTime.localeCompare(b.startTime)
    })
  }, [filteredSlots])

  const rangeDays = useMemo(() => getRangeDays(startDate, endDate), [endDate, startDate])
  const isWeeklyRange = rangeDays <= 7

  const groupedBySubject = useMemo(() => {
    return visibleSubjects
      .map(subject => ({
        subject,
        slots: sortedSlots.filter(slot => slot.subjectId === subject.id),
      }))
      .filter(group => group.slots.length > 0)
  }, [sortedSlots, visibleSubjects])

  return (
    <main className="dash-page">
      <h1>Weekly learning timeline</h1>
      <p className="lead">
        Subjects and active topics on a timescale. This is a UI-first version with sample data to
        tune layout before backend wiring.
      </p>

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

          <div className="dash-filter-actions">
            <button
              type="button"
              className="dash-reset-btn"
              onClick={() => {
                const suggestedStart = addDaysToIsoDate(rangeMaxDate, -6)
                setStartDate(suggestedStart < rangeMinDate ? rangeMinDate : suggestedStart)
                setEndDate(rangeMaxDate)
                setSelectedSubjectId('all')
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
                  by subject.
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
                          <article className="dash-long-range-item" key={slot.id}>
                            <div className="dash-long-range-title">{slot.title}</div>
                            <div className="dash-topic-meta">
                              {formatDateLabel(slot.startDate)}
                              {slot.endDate !== slot.startDate
                                ? ` - ${formatDateLabel(slot.endDate)}`
                                : ''}
                              {` · ${formatSlotMeta(slot)}`}
                            </div>
                          </article>
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
                            <div
                              key={slot.id}
                              className="dash-topic-slot"
                              style={{
                                ...getSlotStyle(slot),
                                borderColor: `${subject.color}AA`,
                                top: `${6 + lane * 46}px`,
                                height: '40px',
                              }}
                            >
                              <div className="dash-topic-title">{slot.title}</div>
                              <div className="dash-topic-meta">
                                {formatSlotMeta(slot)}
                              </div>
                            </div>
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
                  <article className="dash-topic-card" key={slot.id}>
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
                    <p>
                      {formatSlotMeta(slot)}
                    </p>
                  </article>
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
    </main>
  )
}
