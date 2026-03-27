import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConceptType, WtrGraphExtraction } from './types'

const anthropic = new Anthropic()

const WTR_EXTRACTION_PROMPT = `You are parsing a school syllabus document (often called "Weekly Transaction" / WTR).
It is usually a table: Subject, teacher, Current Week topics, Coming Week topics, sometimes tests.

Your job: extract a knowledge map as JSON only — no markdown, no commentary.

Return ONLY valid JSON matching this schema:
{
  "concepts": [
    { "name": string, "subject": string, "type": "topic_concept" | "ib_key_concept" | "cross_subject" }
  ],
  "connections": [
    {
      "concept_a": string,
      "concept_b": string,
      "subject_a": string,
      "subject_b": string,
      "relationship": string
    }
  ]
}

Rules:
1. concepts[] — atomic ideas named in the document (2–6 words), one row per distinct idea across subjects.
   - subject must match the column (e.g. "Mathematics", "Science", "Language & Literature", "History", "Geography", "French").
   - Use "cross_subject" only when the edge explicitly bridges two subjects.
2. connections[] — directed relationships, for example:
   - Current week topic → Coming week topic within the SAME subject: relationship "next in school syllabus" or "follows in schedule".
   - Prerequisite / builds on: "builds on", "applies", "extends".
   - Cross-subject links only when justified by the text (e.g. statistics in Math linked to data in Science).
3. EXISTING CONCEPTS: A list of known concepts from our database is provided below.
   - When a string in the document refers to the SAME idea as an existing concept, reuse the EXACT "name" and "subject" from that list so we merge cleanly.
   - If it is new, invent a concise canonical name (do not duplicate list entries with new spelling).
4. If the document is unclear, still extract what you can; use empty arrays where nothing applies.
5. Output ONLY the JSON object.`

function buildMediaBlock(mimeType: string, base64: string): Anthropic.Messages.ContentBlockParam[] {
  if (mimeType === 'application/pdf') {
    return [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64,
        },
      },
    ]
  }
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp' || mimeType === 'image/gif') {
    return [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: base64,
        },
      },
    ]
  }
  throw new Error(`Unsupported file type for vision: ${mimeType}`)
}

export async function fetchExistingConceptsForPrompt(
  supabase: SupabaseClient,
  opts: { limit?: number } = {}
): Promise<Array<{ name: string; subject: string | null; type: string }>> {
  const limit = opts.limit ?? 400
  const { data, error } = await supabase.from('concepts').select('name, subject, type').limit(limit)
  if (error) {
    console.error('[graph/wtr] fetch concepts error:', error)
    return []
  }
  return data ?? []
}

function parseJsonFromClaudeText(raw: string): unknown {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '')
  }
  return JSON.parse(t)
}

export async function extractWtrGraph(params: {
  fileBase64: string
  mimeType: string
  grade: string | null
  periodLabel: string
  existingConcepts: Array<{ name: string; subject: string | null; type: string }>
}): Promise<WtrGraphExtraction> {
  const existingJson = JSON.stringify(
    params.existingConcepts.map(c => ({
      name: c.name,
      subject: c.subject,
      type: c.type,
    })),
    null,
    0
  )

  const textIntro = `${WTR_EXTRACTION_PROMPT}

Metadata:
- Grade: ${params.grade ?? 'unknown'}
- Report period: ${params.periodLabel}

Existing concepts in database (reuse exact name+subject when same meaning):
${existingJson}

Document:`

  const media = buildMediaBlock(params.mimeType, params.fileBase64)

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: textIntro }, ...media],
      },
    ],
  })

  const text = response.content.find(b => b.type === 'text' && 'text' in b)
  const raw =
    text && text.type === 'text' ? text.text.trim() : ''
  if (!raw) {
    throw new Error('No text in Claude response')
  }

  const parsed = parseJsonFromClaudeText(raw) as WtrGraphExtraction
  if (!Array.isArray(parsed.concepts)) parsed.concepts = []
  if (!Array.isArray(parsed.connections)) parsed.connections = []
  return parsed
}

export async function saveWtrGraphToDatabase(params: {
  supabase: SupabaseClient
  extraction: WtrGraphExtraction
  wtrUploadId: string
  grade: string | null
}): Promise<{ conceptRows: number; connectionRows: number }> {
  const { supabase, extraction, wtrUploadId, grade } = params

  let conceptRows = 0
  if (extraction.concepts.length > 0) {
    const { error } = await supabase.from('concepts').upsert(
      extraction.concepts.map(c => ({
        name: c.name,
        subject: c.subject,
        type: c.type as ConceptType,
        grade: grade ?? null,
      })),
      { onConflict: 'name,subject' }
    )
    if (error) {
      console.error('[graph/wtr] concepts upsert error:', error)
    } else {
      conceptRows = extraction.concepts.length
    }
  }

  let connectionRows = 0
  if (extraction.connections.length > 0) {
    const { error } = await supabase.from('concept_connections').insert(
      extraction.connections.map(c => ({
        child_key: 'curriculum' as const,
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
      console.error('[graph/wtr] connections insert error:', error)
    } else {
      connectionRows = extraction.connections.length
    }
  }

  return { conceptRows, connectionRows }
}
