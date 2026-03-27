#!/usr/bin/env node

/**
 * Extracts the curriculum schedule from WTR files and stores it in curriculum_schedule.
 *
 * For XLSX files: parses directly, extracts current/coming week topics per subject.
 * For PDF files:  infers from existing concept_connections in the database.
 *
 * Matches raw topic text to canonical concept names already in the concepts table.
 */

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CURRICULUM_DIR = path.join(process.cwd(), 'curriculum')

const CANONICAL_SUBJECTS = {
  'language & literature': 'Language & Literature',
  'lang & lit': 'Language & Literature',
  'english': 'Language & Literature',
  'mathematics': 'Mathematics',
  'math': 'Mathematics',
  'maths': 'Mathematics',
  'science': 'Science',
  'sciences': 'Science',
  'history': 'History',
  'geography': 'Geography',
  'french': 'French',
  'second language (french)': 'French',
  'hindi': 'Hindi',
  'second language (hindi)': 'Hindi',
  'spanish': 'Spanish',
  'second language (spanish)': 'Spanish',
  'telugu': 'Telugu',
  'design': 'Design',
  'music': 'Music',
  'visual arts': 'Visual Arts',
  'pahe': 'PAHE',
}

// ── date parsing ─────────────────────────────────────────────────────────────

const MONTH_MAP = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}

function parseDateRange(filename) {
  const clean = filename
    .replace(/^MYP\s*_?\s*WTR\s*/i, '')
    .replace(/\s*-?\s*6A/i, '')
    .replace(/\.(pdf|xlsx)$/i, '')
    .replace(/_/g, ' ')
    .trim()

  // Pattern: "14th July to 18th July" or "1stSep 5thSep" or "02 Feb 06 Feb" or "02 Mar 06 Mar"
  const datePattern = /(\d{1,2})\s*(?:st|nd|rd|th)?\s*([A-Za-z]+)/g
  const matches = [...clean.matchAll(datePattern)]

  if (matches.length < 2) return null

  const parse = (m) => {
    const day = parseInt(m[1], 10)
    const monthKey = m[2].toLowerCase()
    const month = MONTH_MAP[monthKey]
    if (month === undefined) return null
    const year = month >= 6 ? 2025 : 2026 // Jul-Dec = 2025, Jan-Jun = 2026
    const dd = String(day).padStart(2, '0')
    const mm = String(month + 1).padStart(2, '0')
    return `${year}-${mm}-${dd}`
  }

  const start = parse(matches[0])
  const end = parse(matches[matches.length - 1])
  if (!start || !end) return null

  return { start, end }
}

// ── concept matching ─────────────────────────────────────────────────────────

function normalise(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildMatcher(concepts) {
  const bySubject = new Map()
  for (const c of concepts) {
    const subj = c.subject ?? '__null__'
    if (!bySubject.has(subj)) bySubject.set(subj, [])
    bySubject.get(subj).push({ ...c, norm: normalise(c.name) })
  }
  return (rawTopic, subject) => {
    const normRaw = normalise(rawTopic)
    if (normRaw.length < 3) return null

    const candidates = [
      ...(bySubject.get(subject) ?? []),
      ...(bySubject.get('__null__') ?? []),
    ]

    // Exact match
    let best = candidates.find(c => c.norm === normRaw)
    if (best) return best

    // Substring match (concept name appears in raw topic or vice versa)
    best = candidates.find(c => normRaw.includes(c.norm) || c.norm.includes(normRaw))
    if (best) return best

    // Word overlap scoring
    const rawWords = new Set(normRaw.split(' ').filter(w => w.length > 2))
    let bestScore = 0
    for (const c of candidates) {
      const cWords = c.norm.split(' ').filter(w => w.length > 2)
      const overlap = cWords.filter(w => rawWords.has(w)).length
      const score = overlap / Math.max(cWords.length, 1)
      if (score > bestScore && score >= 0.5) {
        bestScore = score
        best = c
      }
    }
    return best ?? null
  }
}

// ── XLSX parsing ─────────────────────────────────────────────────────────────

function parseXlsxSchedule(filePath) {
  const wb = XLSX.readFile(filePath)
  const entries = []

  for (const sheetName of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], { blankrows: false })
    const lines = csv.split('\n')

    let currentSubject = null
    let phase = null // 'current' | 'coming' | null

    for (const line of lines) {
      const lower = line.toLowerCase()

      // Detect subject
      for (const [key, canonical] of Object.entries(CANONICAL_SUBJECTS)) {
        if (lower.includes(key) && (lower.includes('transaction') || lower.includes(','))) {
          const cells = line.split(',')
          const subjectCell = cells.find(c => c.trim().toLowerCase().includes(key))
          if (subjectCell) {
            currentSubject = canonical
            phase = null
            break
          }
        }
      }

      // Detect current/coming
      if (currentSubject) {
        if (lower.includes('current week')) {
          phase = 'current'
          // Topics might be on the same line after "Current Week,"
          const afterLabel = line.split(/current week/i).slice(1).join('')
          const topicText = afterLabel.replace(/^[,"]+/, '').replace(/[,"]+$/, '').trim()
          if (topicText.length > 3) {
            for (const t of splitTopics(topicText)) {
              entries.push({ subject: currentSubject, topic: t, type: 'current' })
            }
          }
          continue
        }
        if (lower.includes('coming week')) {
          phase = 'coming'
          const afterLabel = line.split(/coming week/i).slice(1).join('')
          const topicText = afterLabel.replace(/^[,"]+/, '').replace(/[,"]+$/, '').trim()
          if (topicText.length > 3) {
            for (const t of splitTopics(topicText)) {
              entries.push({ subject: currentSubject, topic: t, type: 'coming' })
            }
          }
          continue
        }
        if (lower.includes('sa / fa test') || lower.includes('test portion')) {
          phase = null
          continue
        }

        // Continuation lines for current/coming
        if (phase) {
          const topicText = line.replace(/^[,"]+/, '').replace(/[,"]+$/, '').trim()
          if (topicText.length > 3 && !lower.includes('coordinator') && !lower.includes('head of school')) {
            for (const t of splitTopics(topicText)) {
              entries.push({ subject: currentSubject, topic: t, type: phase })
            }
          }
        }
      }
    }
  }

  return entries
}

function splitTopics(text) {
  return text
    .split(/\n/)
    .map(t => t.replace(/^[,"\s-]+/, '').replace(/[,"\s]+$/, '').trim())
    .filter(t => t.length > 3)
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Fetch all concepts for matching
  const { data: allConcepts } = await supabase.from('concepts').select('name, subject, type')
  const match = buildMatcher(allConcepts ?? [])

  // Fetch wtr_uploads for linking
  const { data: uploads } = await supabase.from('wtr_uploads').select('id, filename, label')
  const uploadByFilename = new Map()
  for (const u of uploads ?? []) {
    uploadByFilename.set(u.filename, u)
  }

  // Get all curriculum connections for PDF fallback
  const { data: connections } = await supabase
    .from('concept_connections')
    .select('concept_a, subject_a, concept_b, subject_b, relationship, wtr_upload_id')
    .eq('child_key', 'curriculum')
    .not('wtr_upload_id', 'is', null)

  // Build connection-based schedule for PDFs
  const connectionSchedule = new Map() // wtr_upload_id → [{ concept, subject, type }]
  for (const conn of connections ?? []) {
    if (!connectionSchedule.has(conn.wtr_upload_id)) {
      connectionSchedule.set(conn.wtr_upload_id, [])
    }
    const entries = connectionSchedule.get(conn.wtr_upload_id)

    if (conn.relationship === 'next in school syllabus' || conn.relationship === 'follows in schedule') {
      entries.push({ concept: conn.concept_a, subject: conn.subject_a, type: 'current' })
      entries.push({ concept: conn.concept_b, subject: conn.subject_b, type: 'coming' })
    } else if (conn.subject_b !== null) {
      // "builds on", "prerequisite for", etc — both are from same week section
      entries.push({ concept: conn.concept_a, subject: conn.subject_a, type: 'current' })
      entries.push({ concept: conn.concept_b, subject: conn.subject_b, type: 'current' })
    }
  }

  // Process all files
  const allFiles = fs.readdirSync(CURRICULUM_DIR)
    .filter(f => /\.(pdf|xlsx)$/i.test(f))
    .sort()

  let totalInserted = 0
  let totalSkipped = 0
  let totalFiles = 0

  for (const filename of allFiles) {
    const filePath = path.join(CURRICULUM_DIR, filename)
    const ext = path.extname(filename).toLowerCase()
    const dates = parseDateRange(filename)
    if (!dates) {
      console.log(`SKIP ${filename} — could not parse dates`)
      continue
    }

    const upload = uploadByFilename.get(filename)
    const uploadId = upload?.id ?? null
    totalFiles++

    console.log(`\n${filename}`)
    console.log(`  Dates: ${dates.start} → ${dates.end}`)

    const scheduleRows = []

    if (ext === '.xlsx') {
      // Parse directly
      const rawEntries = parseXlsxSchedule(filePath)
      const seen = new Set()

      for (const entry of rawEntries) {
        const matched = match(entry.topic, entry.subject)
        if (matched) {
          const key = `${matched.name}|${matched.subject}|${entry.type}`
          if (seen.has(key)) continue
          seen.add(key)
          scheduleRows.push({
            concept_name: matched.name,
            subject: matched.subject ?? entry.subject,
            week_start: dates.start,
            week_end: dates.end,
            schedule_type: entry.type,
            grade: 'Grade 6',
            wtr_upload_id: uploadId,
          })
        } else {
          totalSkipped++
        }
      }
    } else {
      // PDF: use connection data
      if (uploadId && connectionSchedule.has(uploadId)) {
        const seen = new Set()
        for (const entry of connectionSchedule.get(uploadId)) {
          if (!entry.subject) continue
          const key = `${entry.concept}|${entry.subject}|${entry.type}`
          if (seen.has(key)) continue
          seen.add(key)
          scheduleRows.push({
            concept_name: entry.concept,
            subject: entry.subject,
            week_start: dates.start,
            week_end: dates.end,
            schedule_type: entry.type,
            grade: 'Grade 6',
            wtr_upload_id: uploadId,
          })
        }
      }
    }

    if (scheduleRows.length > 0) {
      const { error, count } = await supabase
        .from('curriculum_schedule')
        .upsert(scheduleRows, { onConflict: 'concept_name,subject,week_start,schedule_type', ignoreDuplicates: true })

      if (error) {
        console.log(`  ERROR: ${error.message}`)
      } else {
        console.log(`  Inserted: ${scheduleRows.length} schedule entries`)
        totalInserted += scheduleRows.length
      }
    } else {
      console.log(`  No schedule entries found`)
    }
  }

  // Final stats
  const { count } = await supabase.from('curriculum_schedule').select('id', { count: 'exact', head: true })
  console.log('\n' + '='.repeat(60))
  console.log(`Processed: ${totalFiles} files`)
  console.log(`Inserted: ${totalInserted} schedule entries`)
  console.log(`Skipped (no match): ${totalSkipped} raw topics`)
  console.log(`Total rows in curriculum_schedule: ${count}`)
  console.log('='.repeat(60))
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
