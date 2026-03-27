#!/usr/bin/env node

/**
 * Batch-imports all curriculum files (PDFs + XLSX) from the curriculum/ directory.
 *
 * For PDFs:  sends as base64 document to Claude
 * For XLSX: converts to a markdown table, sends as text to Claude
 *
 * Usage:  node scripts/import-curriculum.mjs
 */

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import XLSX from 'xlsx'

// ── env ──────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(1)
}
if (!ANTHROPIC_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })

const CURRICULUM_DIR = path.join(process.cwd(), 'curriculum')
const PROMPTS_DIR = path.join(process.cwd(), 'prompts')

// ── prompt loading ───────────────────────────────────────────────────────────

function loadPrompt(filename) {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf-8')
}

const SHARED_RULES = loadPrompt('shared-rules.md')
const WTR_PROMPT = loadPrompt('wtr-extraction.md')
const EXTRACTION_MAX_TOKENS = 8192

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchExistingConcepts() {
  const { data, error } = await supabase
    .from('concepts')
    .select('name, subject, type')
    .limit(500)
  if (error) {
    console.error('  ⚠ fetch concepts error:', error.message)
    return []
  }
  return data ?? []
}

function parseJsonFromClaude(raw) {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '')
  }
  return JSON.parse(t)
}

function parseDateFromFilename(filename) {
  // Extract month/day hints for sorting — rough chronological ordering
  const monthMap = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  }
  const lower = filename.toLowerCase()
  let month = 0
  let day = 0
  for (const [abbr, num] of Object.entries(monthMap)) {
    const idx = lower.indexOf(abbr)
    if (idx !== -1) {
      month = num
      // try to find a number right before month abbreviation
      const before = lower.slice(Math.max(0, idx - 5), idx)
      const dayMatch = before.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*$/)
      if (dayMatch) day = parseInt(dayMatch[1], 10)
      break
    }
  }
  // Infer year: files from Jul-Dec are 2025, Jan-Mar are 2026
  const year = month >= 7 ? 2025 : 2026
  return new Date(year, month - 1, day || 1)
}

function xlsxToMarkdown(filePath) {
  const workbook = XLSX.readFile(filePath)
  const parts = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    if (!csv.trim()) continue
    // Convert CSV to markdown table
    const rows = csv.split('\n').filter(r => r.trim())
    if (rows.length === 0) continue
    parts.push(`### Sheet: ${sheetName}\n`)
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].split(',').map(c => c.trim())
      parts.push('| ' + cells.join(' | ') + ' |')
      if (i === 0) {
        parts.push('|' + cells.map(() => '---').join('|') + '|')
      }
    }
    parts.push('')
  }
  return parts.join('\n')
}

function derivePeriodLabel(filename) {
  return filename
    .replace(/\.(pdf|xlsx)$/i, '')
    .replace(/^MYP\s*_?\s*WTR\s*/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── extraction ───────────────────────────────────────────────────────────────

async function extractFromPdf(filePath, periodLabel, existingConcepts) {
  const buffer = fs.readFileSync(filePath)
  const base64 = buffer.toString('base64')

  const prompt = `${SHARED_RULES}

${WTR_PROMPT}

---

Metadata:
- Grade: Grade 6
- Report period: ${periodLabel}

Existing concepts in database (reuse exact name+subject when same meaning):
${JSON.stringify(existingConcepts, null, 0)}

Document:`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: EXTRACTION_MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
        ],
      },
    ],
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text in Claude response')
  return parseJsonFromClaude(textBlock.text)
}

async function extractFromXlsx(filePath, periodLabel, existingConcepts) {
  const markdownTable = xlsxToMarkdown(filePath)

  const prompt = `${SHARED_RULES}

${WTR_PROMPT}

---

Metadata:
- Grade: Grade 6
- Report period: ${periodLabel}

Existing concepts in database (reuse exact name+subject when same meaning):
${JSON.stringify(existingConcepts, null, 0)}

Document content (converted from spreadsheet):

${markdownTable}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: EXTRACTION_MAX_TOKENS,
    messages: [
      { role: 'user', content: prompt },
    ],
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text in Claude response')
  return parseJsonFromClaude(textBlock.text)
}

// ── save to database ─────────────────────────────────────────────────────────

async function saveToDatabase(extraction, wtrUploadId, grade) {
  const errors = []
  let conceptRows = 0
  let connectionRows = 0

  if (extraction.concepts?.length > 0) {
    // Split: concepts with a subject can use the regular UNIQUE constraint,
    // IB key concepts (null subject) are already seeded — skip those.
    const withSubject = extraction.concepts.filter(c => c.subject)
    const nullSubject = extraction.concepts.filter(c => !c.subject)

    if (withSubject.length > 0) {
      const { error } = await supabase.from('concepts').upsert(
        withSubject.map(c => ({
          name: c.name,
          subject: c.subject,
          type: c.type,
          grade: grade ?? null,
        })),
        { onConflict: 'name,subject', ignoreDuplicates: true }
      )
      if (error) {
        errors.push(`concepts: ${error.message}`)
      } else {
        conceptRows = withSubject.length
      }
    }

    // For null-subject concepts (IB key concepts), just try inserting — ignore duplicates
    for (const c of nullSubject) {
      const { error } = await supabase.from('concepts').insert({
        name: c.name,
        subject: null,
        type: c.type,
        grade: grade ?? null,
      })
      if (!error) {
        conceptRows++
      } else if (!error.message.includes('duplicate') && !error.message.includes('unique')) {
        errors.push(`concept(${c.name}): ${error.message}`)
      }
    }
  }

  if (extraction.connections?.length > 0) {
    const { error } = await supabase.from('concept_connections').insert(
      extraction.connections.map(c => ({
        child_key: 'curriculum',
        concept_a: c.concept_a,
        concept_b: c.concept_b,
        subject_a: c.subject_a,
        subject_b: c.subject_b,
        relationship: c.relationship,
        episode_id: null,
        wtr_upload_id: wtrUploadId,
      }))
    )
    if (error) {
      errors.push(`connections: ${error.message}`)
    } else {
      connectionRows = extraction.connections.length
    }
  }

  return { conceptRows, connectionRows, errors }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const requestedFiles = new Set(process.argv.slice(2))
  const allFiles = fs.readdirSync(CURRICULUM_DIR)
    .filter(f => /\.(pdf|xlsx)$/i.test(f))
    .filter(f => requestedFiles.size === 0 || requestedFiles.has(f))
    .map(f => ({
      name: f,
      path: path.join(CURRICULUM_DIR, f),
      ext: path.extname(f).toLowerCase(),
      date: parseDateFromFilename(f),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  console.log(`\nFound ${allFiles.length} curriculum files to import.\n`)
  console.log('Processing in chronological order so the concept list grows progressively.\n')

  let totalConcepts = 0
  let totalConnections = 0
  let successCount = 0
  let failCount = 0

  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i]
    const label = `[${i + 1}/${allFiles.length}]`
    const periodLabel = derivePeriodLabel(file.name)
    let uploadId = null

    console.log(`${label} ${file.name}`)
    console.log(`     Period: ${periodLabel}  |  Type: ${file.ext}`)

    try {
      // Create upload record
      const mimeType = file.ext === '.pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const fileSize = fs.statSync(file.path).size

      const { data: uploadRow, error: insertErr } = await supabase
        .from('wtr_uploads')
        .insert({
          filename: file.name,
          period_type: 'weekly',
          grade: 'Grade 6',
          label: periodLabel,
          mime_type: mimeType,
          file_size_bytes: fileSize,
          status: 'processing',
        })
        .select('id')
        .single()

      if (insertErr || !uploadRow) {
        console.log(`     FAIL: could not create upload row: ${insertErr?.message}`)
        failCount++
        continue
      }

      uploadId = uploadRow.id

      // Fetch existing concepts (grows with each import)
      const existingConcepts = await fetchExistingConcepts()
      console.log(`     Existing concepts in DB: ${existingConcepts.length}`)

      // Extract
      let extraction
      if (file.ext === '.pdf') {
        extraction = await extractFromPdf(file.path, periodLabel, existingConcepts)
      } else {
        extraction = await extractFromXlsx(file.path, periodLabel, existingConcepts)
      }

      if (!Array.isArray(extraction.concepts)) extraction.concepts = []
      if (!Array.isArray(extraction.connections)) extraction.connections = []

      console.log(`     Extracted: ${extraction.concepts.length} concepts, ${extraction.connections.length} connections`)

      // Save
      const { conceptRows, connectionRows, errors } = await saveToDatabase(extraction, uploadId, 'Grade 6')

      const status = errors.length > 0 ? 'failed' : 'completed'
      await supabase
        .from('wtr_uploads')
        .update({
          status,
          completed_at: status === 'completed' ? new Date().toISOString() : null,
          extraction_summary: {
            concepts: extraction.concepts.length,
            connections: extraction.connections.length,
            conceptRowsUpserted: conceptRows,
            connectionRowsInserted: connectionRows,
            ...(errors.length > 0 ? { saveErrors: errors } : {}),
          },
          error_message: errors.length > 0 ? errors.join('; ') : null,
        })
        .eq('id', uploadId)

      if (errors.length > 0) {
        console.log(`     PARTIAL: ${errors.join(', ')}`)
        failCount++
      } else {
        console.log(`     OK: ${conceptRows} concepts upserted, ${connectionRows} connections inserted`)
        successCount++
      }

      totalConcepts += conceptRows
      totalConnections += connectionRows

    } catch (err) {
      console.log(`     ERROR: ${err.message}`)
      if (uploadId) {
        await supabase
          .from('wtr_uploads')
          .update({
            status: 'failed',
            error_message: err.message,
          })
          .eq('id', uploadId)
      }
      failCount++
    }

    // Small delay to avoid rate limiting
    if (i < allFiles.length - 1) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log(`DONE: ${successCount} succeeded, ${failCount} failed`)
  console.log(`Total concepts upserted: ${totalConcepts}`)
  console.log(`Total connections inserted: ${totalConnections}`)

  // Final count from DB
  const { count: conceptCount } = await supabase.from('concepts').select('id', { count: 'exact', head: true })
  const { count: connCount } = await supabase.from('concept_connections').select('id', { count: 'exact', head: true })
  console.log(`\nDB totals: concepts=${conceptCount ?? '?'}, connections=${connCount ?? '?'}`)
  console.log('='.repeat(60) + '\n')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
