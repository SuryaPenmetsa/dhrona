export type Subject = {
  id: string
  name: string
  shortCode: string
  color: string
}

export type TopicSlot = {
  id: string
  subjectId: string
  title: string
  teacher: string
  scheduleType?: 'current' | 'coming' | null
  weekIndex: number
  startDay: number
  endDay: number
  startTime: string
  endTime: string
  startDate: string
  endDate: string
}

type RawTopicSlot = Omit<TopicSlot, 'startDate' | 'endDate'>

export const timelineDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

const weekStartDates = ['2026-03-24', '2026-03-31', '2026-04-07', '2026-04-14']

const SUBJECT_PALETTE: Record<string, string> = {
  Mathematics: '#185FA5',
  Science: '#27ae85',
  Sciences: '#854F0B',
  History: '#e6a23c',
  Geography: '#9b6bff',
  'Language & Literature': '#1D9E75',
  French: '#f59e0b',
  Spanish: '#f06543',
  Hindi: '#e05297',
  Telugu: '#c084fc',
  Design: '#993C1D',
  Music: '#d97706',
  'Visual Arts': '#ec4899',
  PAHE: '#14b8a6',
  'Physical & Health Education': '#3B6D11',
  Advisory: '#5F5E5A',
}

export const subjects: Subject[] = [
  { id: 'math', name: 'Mathematics', shortCode: 'MATH', color: '#185FA5' },
  { id: 'sci', name: 'Sciences', shortCode: 'SCI', color: '#854F0B' },
  { id: 'll', name: 'Language & Literature', shortCode: 'LL', color: '#1D9E75' },
  { id: 'is', name: 'Individuals & Societies', shortCode: 'IS', color: '#993556' },
  { id: 'des', name: 'Design', shortCode: 'DES', color: '#993C1D' },
]

const rawTopicSlots: RawTopicSlot[] = [
  {
    id: 't1',
    subjectId: 'math',
    title: 'Ratios & Proportions',
    teacher: 'Ms. Rao',
    weekIndex: 0,
    startDay: 0,
    endDay: 1,
    startTime: '09:00',
    endTime: '09:45',
  },
  {
    id: 't2',
    subjectId: 'sci',
    title: 'Cells & Microscopy',
    teacher: 'Mr. Sen',
    weekIndex: 0,
    startDay: 1,
    endDay: 2,
    startTime: '10:00',
    endTime: '10:45',
  },
  {
    id: 't3',
    subjectId: 'll',
    title: 'Narrative Voice',
    teacher: 'Ms. Priya',
    weekIndex: 0,
    startDay: 2,
    endDay: 2,
    startTime: '11:00',
    endTime: '11:45',
  },
  {
    id: 't4',
    subjectId: 'is',
    title: 'Ancient River Civilizations',
    teacher: 'Mr. Daniel',
    weekIndex: 0,
    startDay: 3,
    endDay: 4,
    startTime: '09:00',
    endTime: '09:45',
  },
  {
    id: 't5',
    subjectId: 'des',
    title: 'User Journey Mapping',
    teacher: 'Ms. Aisha',
    weekIndex: 0,
    startDay: 4,
    endDay: 4,
    startTime: '13:00',
    endTime: '13:45',
  },
  {
    id: 't6',
    subjectId: 'math',
    title: 'Fractions to Decimals',
    teacher: 'Ms. Rao',
    weekIndex: 1,
    startDay: 0,
    endDay: 0,
    startTime: '09:00',
    endTime: '09:45',
  },
  {
    id: 't7',
    subjectId: 'sci',
    title: 'Energy Transfer',
    teacher: 'Mr. Sen',
    weekIndex: 1,
    startDay: 2,
    endDay: 3,
    startTime: '10:00',
    endTime: '10:45',
  },
  {
    id: 't8',
    subjectId: 'll',
    title: 'Poetry Analysis',
    teacher: 'Ms. Priya',
    weekIndex: 1,
    startDay: 4,
    endDay: 4,
    startTime: '11:00',
    endTime: '11:45',
  },
  {
    id: 't9',
    subjectId: 'is',
    title: 'Trade Routes of Asia',
    teacher: 'Mr. Daniel',
    weekIndex: 2,
    startDay: 1,
    endDay: 2,
    startTime: '09:00',
    endTime: '09:45',
  },
  {
    id: 't10',
    subjectId: 'des',
    title: 'Prototype Feedback Loop',
    teacher: 'Ms. Aisha',
    weekIndex: 2,
    startDay: 3,
    endDay: 4,
    startTime: '13:00',
    endTime: '13:45',
  },
  {
    id: 't11',
    subjectId: 'math',
    title: 'Linear Equations',
    teacher: 'Ms. Rao',
    weekIndex: 3,
    startDay: 1,
    endDay: 2,
    startTime: '09:00',
    endTime: '09:45',
  },
  {
    id: 't12',
    subjectId: 'll',
    title: 'Debate Structure',
    teacher: 'Ms. Priya',
    weekIndex: 3,
    startDay: 3,
    endDay: 3,
    startTime: '11:00',
    endTime: '11:45',
  },
]

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const utcDate = new Date(`${isoDate}T00:00:00Z`)
  utcDate.setUTCDate(utcDate.getUTCDate() + days)
  return utcDate.toISOString().slice(0, 10)
}

export function toSubjectId(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function subjectColor(subject: string): string {
  if (SUBJECT_PALETTE[subject]) return SUBJECT_PALETTE[subject]
  // Stable fallback color for unseen subjects.
  let hash = 0
  for (let i = 0; i < subject.length; i += 1) {
    hash = (hash * 31 + subject.charCodeAt(i)) % 360
  }
  return `hsl(${hash} 55% 46%)`
}

export function shortCodeForSubject(subject: string): string {
  if (subject === 'Mathematics') return 'MATH'
  if (subject === 'Science' || subject === 'Sciences') return 'SCI'
  if (subject === 'History') return 'HIS'
  if (subject === 'Geography') return 'GEO'
  if (subject === 'Music') return 'MUS'
  if (subject === 'French') return 'FR'
  if (subject === 'Hindi') return 'HIN'
  if (subject === 'Telugu') return 'TEL'
  if (subject === 'Visual Arts') return 'ART'
  if (subject === 'Language & Literature') return 'LL'
  if (subject === 'Individuals & Societies') return 'IS'
  if (subject === 'Physical & Health Education') return 'PHE'
  const words = subject
    .replace(/&/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return subject.slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map(word => word[0].toUpperCase())
    .join('')
}

export function buildSubjectsFromNames(names: string[]): Subject[] {
  return names
    .filter(Boolean)
    .map(name => ({
      id: toSubjectId(name),
      name,
      shortCode: shortCodeForSubject(name),
      color: subjectColor(name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function weekdayIndexFromIso(isoDate: string): number {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay() // 0=Sun ... 6=Sat
  const mondayFirst = (day + 6) % 7 // 0=Mon ... 6=Sun
  return Math.min(4, Math.max(0, mondayFirst))
}

export function buildTopicSlots(): TopicSlot[] {
  return rawTopicSlots.map(slot => {
    const weekStart = weekStartDates[slot.weekIndex] ?? weekStartDates[0]
    return {
      ...slot,
      startDate: addDaysToIsoDate(weekStart, slot.startDay),
      endDate: addDaysToIsoDate(weekStart, slot.endDay),
    }
  })
}

export function getTimelineBounds(slots: TopicSlot[]) {
  const minDate = slots.reduce((min, slot) => (slot.startDate < min ? slot.startDate : min), slots[0].startDate)
  const maxDate = slots.reduce((max, slot) => (slot.endDate > max ? slot.endDate : max), slots[0].endDate)
  return { minDate, maxDate }
}
