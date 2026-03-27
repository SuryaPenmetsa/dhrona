import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConceptType, WtrGraphExtraction } from './types'
import { getSharedRules, getWtrExtractionPrompt, formatExistingConceptsBlock } from './prompts'

const anthropic = new Anthropic()

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
  const textIntro = `${getSharedRules()}

${getWtrExtractionPrompt()}

---

Metadata:
- Grade: ${params.grade ?? 'unknown'}
- Report period: ${params.periodLabel}

Existing concepts in database (reuse exact name+subject when same meaning):
${formatExistingConceptsBlock(params.existingConcepts)}

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

export interface WtrSaveResult {
  conceptRows: number
  connectionRows: number
  errors: string[]
}

export async function saveWtrGraphToDatabase(params: {
  supabase: SupabaseClient
  extraction: WtrGraphExtraction
  wtrUploadId: string
  grade: string | null
}): Promise<WtrSaveResult> {
  const { supabase, extraction, wtrUploadId, grade } = params
  const errors: string[] = []

  let conceptRows = 0
  if (extraction.concepts.length > 0) {
    const { error } = await supabase.from('concepts').upsert(
      extraction.concepts.map(c => ({
        name: c.name,
        subject: c.subject,
        type: c.type as ConceptType,
        grade: grade ?? null,
      })),
      { onConflict: 'name,subject', ignoreDuplicates: true }
    )
    if (error) {
      console.error('[graph/wtr] concepts upsert error:', error)
      errors.push(`concepts: ${error.message}`)
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
      errors.push(`connections: ${error.message}`)
    } else {
      connectionRows = extraction.connections.length
    }
  }

  return { conceptRows, connectionRows, errors }
}
