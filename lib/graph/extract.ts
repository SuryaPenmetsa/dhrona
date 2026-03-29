import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { ChildKey, GraphExtraction } from './types'
import { fetchExistingConceptsForPrompt } from './wtr'
import { getSharedRules, getSessionExtractionPrompt, formatExistingConceptsBlock, formatOpenGapsBlock } from './prompts'

const anthropic = new Anthropic()

function parseJsonFromClaudeText(raw: string): unknown {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '')
  }
  return JSON.parse(t)
}

export async function extractAndSaveGraph({
  childKey,
  episodeId,
  subject,
  topic,
  grade,
  messages,
}: {
  childKey: ChildKey
  episodeId: string
  subject: string
  topic: string
  grade?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<GraphExtraction | null> {
  const supabase = await createClient()

  const [existingConcepts, { data: openGaps }] = await Promise.all([
    fetchExistingConceptsForPrompt(supabase, { limit: 500 }),
    supabase
      .from('learning_gaps')
      .select('concept, subject, note')
      .eq('child_key', childKey)
      .eq('status', 'open')
      .limit(20),
  ])

  const transcript = messages
    .map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
    .join('\n\n')

  let extraction: GraphExtraction
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `${getSessionExtractionPrompt()}

${getSharedRules()}

---

Session context:
- Subject: ${subject}
- Topic: ${topic}
- Student: ${childKey}
- Grade: ${grade ?? 'unknown'}

Existing concepts in database (reuse exact name+subject when same meaning):
${formatExistingConceptsBlock(existingConcepts)}

Open gaps for this student (use exact concept name if resolved):
${formatOpenGapsBlock(openGaps ?? [])}

Transcript:
${transcript}`,
        },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    extraction = parseJsonFromClaudeText(text) as GraphExtraction
    if (!Array.isArray(extraction.concepts)) extraction.concepts = []
    if (!Array.isArray(extraction.connections)) extraction.connections = []
    if (!Array.isArray(extraction.gaps)) extraction.gaps = []
    if (!Array.isArray(extraction.gaps_resolved)) extraction.gaps_resolved = []
  } catch (err) {
    console.error('[graph/extract] Claude extraction failed:', err)
    return null
  }

  const errors: string[] = []

  if (extraction.concepts.length > 0) {
    const { error } = await supabase.from('concepts').upsert(
      extraction.concepts.map(c => ({
        name: c.name,
        subject: c.subject,
        type: c.type,
        grade: grade ?? null,
      })),
      { onConflict: 'name,subject', ignoreDuplicates: true }
    )
    if (error) {
      console.error('[graph/extract] concepts upsert error:', error)
      errors.push(`concepts: ${error.message}`)
    }
  }

  if (extraction.connections.length > 0) {
    const { error } = await supabase.from('concept_connections').insert(
      extraction.connections.map(c => ({
        child_key: childKey,
        concept_a: c.concept_a,
        concept_b: c.concept_b,
        subject_a: c.subject_a,
        subject_b: c.subject_b,
        relationship: c.relationship,
        episode_id: episodeId,
      }))
    )
    if (error) {
      console.error('[graph/extract] connections insert error:', error)
      errors.push(`connections: ${error.message}`)
    }
  }

  if (extraction.gaps.length > 0) {
    const { error } = await supabase.from('learning_gaps').insert(
      extraction.gaps.map(g => ({
        child_key: childKey,
        concept: g.concept,
        subject: g.subject,
        note: g.note,
        status: 'open',
        episode_id: episodeId,
      }))
    )
    if (error) {
      console.error('[graph/extract] gaps insert error:', error)
      errors.push(`gaps: ${error.message}`)
    }
  }

  if (extraction.gaps_resolved.length > 0) {
    const resolvedConcepts = extraction.gaps_resolved.map(g => g.concept)
    const { error } = await supabase
      .from('learning_gaps')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('child_key', childKey)
      .in('concept', resolvedConcepts)
      .eq('status', 'open')
    if (error) {
      console.error('[graph/extract] batch gap resolve error:', error)
      errors.push(`gap_resolve: ${error.message}`)
    }
  }

  if (errors.length > 0) {
    console.error('[graph/extract] completed with errors:', errors)
  }

  return extraction
}
