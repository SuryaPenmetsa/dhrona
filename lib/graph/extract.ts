import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { ChildKey, GraphExtraction } from './types'

const anthropic = new Anthropic()

const EXTRACTION_PROMPT = `
You are analysing a tutoring session transcript for a 12-year-old IB MYP student.

Extract the following and return ONLY valid JSON matching the schema below.
No preamble, no explanation, no markdown fences.

Extract:
1. concepts[] — specific named concepts that were meaningfully discussed
   (not every word, only ideas that were actually explored or explained)
2. connections[] — links between concepts that emerged in this session
   (especially cross-subject links — e.g. parabolas in maths = projectile motion in physics)
3. gaps[] — concepts the student clearly did NOT understand by the end
   (look for: confusion, repeated wrong answers, "I don't get why", trailing off)
4. gaps_resolved[] — concept names matching previously unresolved gaps
   that now appear understood (the student got it in this session)

Schema:
{
  "concepts": [
    { "name": string, "subject": string, "type": "topic_concept" | "ib_key_concept" | "cross_subject" }
  ],
  "connections": [
    { 
      "concept_a": string, "subject_a": string,
      "concept_b": string, "subject_b": string,
      "relationship": string
    }
  ],
  "gaps": [
    { "concept": string, "subject": string, "note": string }
  ],
  "gaps_resolved": [
    { "concept": string }
  ]
}

Rules:
- concept names should be short (2-5 words): "Quadratic equations", "Projectile motion"
- relationship should be a short phrase: "same mathematical shape", "real-world example of", "prerequisite for", "same IB key concept as"
- gap note should be one sentence: what specifically they didn't understand
- if nothing fits a category, return an empty array for it
- return ONLY the JSON object, nothing else
`

export async function extractAndSaveGraph({
  childKey,
  episodeId,
  subject,
  topic,
  messages,
}: {
  childKey: ChildKey
  episodeId: string
  subject: string
  topic: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<GraphExtraction | null> {
  // Format transcript for Claude
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
    .join('\n\n')

  // Call Claude to extract graph
  let extraction: GraphExtraction
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}

Session context:
Subject: ${subject}
Topic: ${topic}
Student: ${childKey}

Transcript:
${transcript}`,
        },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    extraction = JSON.parse(text.trim()) as GraphExtraction
  } catch (err) {
    console.error('[graph/extract] Claude extraction failed:', err)
    return null
  }

  const supabase = await createClient()

  // Save concepts (upsert — same concept may appear across sessions)
  if (extraction.concepts.length > 0) {
    const { error } = await supabase.from('concepts').upsert(
      extraction.concepts.map(c => ({
        name: c.name,
        subject: c.subject,
        type: c.type,
        grade: '6th Grade',
      })),
      { onConflict: 'name,subject', ignoreDuplicates: true }
    )
    if (error) console.error('[graph/extract] concepts upsert error:', error)
  }

  // Save connections
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
    if (error) console.error('[graph/extract] connections insert error:', error)
  }

  // Save new gaps
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
    if (error) console.error('[graph/extract] gaps insert error:', error)
  }

  // Resolve gaps that were fixed in this session
  if (extraction.gaps_resolved.length > 0) {
    for (const resolved of extraction.gaps_resolved) {
      const { error } = await supabase
        .from('learning_gaps')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('child_key', childKey)
        .eq('concept', resolved.concept)
        .eq('status', 'open')
      if (error) console.error('[graph/extract] gap resolve error:', error)
    }
  }

  return extraction
}
