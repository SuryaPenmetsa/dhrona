'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type DateRangeValue = {
  startDate: string
  endDate: string
}

type DateRangePickerProps = {
  value: DateRangeValue
  minDate: string
  maxDate: string
  onChange: (value: DateRangeValue) => void
}

const weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return { year, month, day }
}

function monthStart(isoDate: string) {
  const { year, month } = parseIsoDate(isoDate)
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function toMonthIso(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function shiftMonth(isoDate: string, deltaMonths: number) {
  const { year, month } = parseIsoDate(isoDate)
  const date = new Date(Date.UTC(year, month - 1 + deltaMonths, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatLabel(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function buildCalendarCells(monthIsoDate: string) {
  const { year, month } = parseIsoDate(monthIsoDate)
  const firstDayDate = `${year}-${String(month).padStart(2, '0')}-01`
  const firstWeekday = new Date(`${firstDayDate}T00:00:00Z`).getUTCDay()
  const totalDays = daysInMonth(year, month)

  const cells: string[] = []
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push('')
  }
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) {
    cells.push('')
  }
  return cells
}

export default function DateRangePicker({ value, minDate, maxDate, onChange }: DateRangePickerProps) {
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [anchorMonth, setAnchorMonth] = useState(monthStart(value.startDate))
  const [pendingStart, setPendingStart] = useState<string | null>(null)
  const currentYear = new Date().getUTCFullYear()
  const yearOptions = useMemo(() => {
    const years: number[] = []
    for (let year = 1900; year <= currentYear + 20; year += 1) {
      years.push(year)
    }
    return years
  }, [currentYear])

  const secondMonth = useMemo(() => shiftMonth(anchorMonth, 1), [anchorMonth])

  useEffect(() => {
    setAnchorMonth(monthStart(value.startDate))
  }, [value.startDate])

  useEffect(() => {
    function onOutsideClick(event: MouseEvent) {
      if (!pickerRef.current) return
      const target = event.target as Node
      if (!pickerRef.current.contains(target)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [])

  function handlePickDate(isoDate: string) {
    if (!pendingStart) {
      setPendingStart(isoDate)
      onChange({ startDate: isoDate, endDate: isoDate })
      return
    }
    const startDate = pendingStart <= isoDate ? pendingStart : isoDate
    const endDate = pendingStart <= isoDate ? isoDate : pendingStart
    onChange({ startDate, endDate })
    setPendingStart(null)
    setOpen(false)
  }

  function movePrevMonth() {
    setAnchorMonth(prev => shiftMonth(prev, -1))
  }

  function moveNextMonth() {
    setAnchorMonth(prev => shiftMonth(prev, 1))
  }

  function setMonthByParts(year: number, month: number) {
    setAnchorMonth(toMonthIso(year, month))
  }

  function setSecondMonthByParts(year: number, month: number) {
    const target = toMonthIso(year, month)
    setAnchorMonth(shiftMonth(target, -1))
  }

  function renderMonth(monthIsoDate: string, side: 'left' | 'right') {
    const cells = buildCalendarCells(monthIsoDate)
    const parts = parseIsoDate(monthIsoDate)
    return (
      <div className="dash-date-month">
        <div className="dash-date-month-head">
          <select
            className="dash-date-month-select"
            aria-label={`${side} month`}
            value={parts.month}
            onChange={e => {
              const nextMonth = Number(e.target.value)
              if (side === 'left') {
                setMonthByParts(parts.year, nextMonth)
              } else {
                setSecondMonthByParts(parts.year, nextMonth)
              }
            }}
          >
            {monthNames.map((monthName, index) => (
              <option key={`${monthIsoDate}-${monthName}`} value={index + 1}>
                {monthName}
              </option>
            ))}
          </select>
          <select
            className="dash-date-month-select dash-date-year-select"
            aria-label={`${side} year`}
            value={parts.year}
            onChange={e => {
              const nextYear = Number(e.target.value)
              if (side === 'left') {
                setMonthByParts(nextYear, parts.month)
              } else {
                setSecondMonthByParts(nextYear, parts.month)
              }
            }}
          >
            {yearOptions.map(year => (
              <option key={`${monthIsoDate}-${year}`} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div className="dash-date-weekdays">
          {weekdayLabels.map(label => (
            <span key={`${monthIsoDate}-${label}`}>{label}</span>
          ))}
        </div>
        <div className="dash-date-days-grid">
          {cells.map((isoDate, index) => {
            if (!isoDate) {
              return <span key={`${monthIsoDate}-empty-${index}`} className="dash-date-day-empty" />
            }
            const inRange = isoDate >= value.startDate && isoDate <= value.endDate
            const isStart = isoDate === value.startDate
            const isEnd = isoDate === value.endDate

            return (
              <button
                key={`${monthIsoDate}-${isoDate}`}
                type="button"
                className={`dash-date-day ${inRange ? 'dash-date-day-in-range' : ''} ${isStart || isEnd ? 'dash-date-day-edge' : ''}`}
                onClick={() => handlePickDate(isoDate)}
              >
                {parseIsoDate(isoDate).day}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="dash-date-picker" ref={pickerRef}>
      <button type="button" className="dash-date-trigger" onClick={() => setOpen(v => !v)}>
        <span className="dash-date-trigger-icon">📅</span>
        <span>
          {formatLabel(value.startDate)} - {formatLabel(value.endDate)}
        </span>
      </button>

      {open ? (
        <div className="dash-date-popover">
          <div className="dash-date-nav">
            <button type="button" className="dash-date-nav-btn" onClick={movePrevMonth}>
              &#8249;
            </button>
            <button type="button" className="dash-date-nav-btn" onClick={moveNextMonth}>
              &#8250;
            </button>
          </div>
          <div className="dash-date-months">
            {renderMonth(anchorMonth, 'left')}
            {renderMonth(secondMonth, 'right')}
          </div>
          <div className="dash-date-footer">
            <button
              type="button"
              className="dash-date-footer-btn"
              onClick={() => {
                setPendingStart(null)
                onChange({ startDate: minDate, endDate: maxDate })
              }}
            >
              Full range
            </button>
            <button
              type="button"
              className="dash-date-footer-btn"
              onClick={() => {
                const thisWeekEnd = addDays(value.startDate, 6)
                setPendingStart(null)
                onChange({
                  startDate: value.startDate,
                  endDate: thisWeekEnd,
                })
              }}
            >
              +7 days
            </button>
            <button
              type="button"
              className="dash-date-footer-btn"
              onClick={() => {
                setPendingStart(null)
                setOpen(false)
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
