import { createClient } from '@/lib/supabase/server'
import type { ChildKey, Concept, TopicGraphContext } from './types'

export async function getTopicContext({
  childKey,
  subject,
  topic,
}: {
  childKey: ChildKey
  subject: string
  topic: string
}): Promise<TopicGraphContext> {
  const supabase = await createClient()

  const [
    { data: topicConcepts },
    { data: subjectConcepts },
    { data: crossSubjectConcepts },
    { data: topicConnections },
    { data: subjectConnections },
    { data: open_gaps },
    { data: resolved_gaps },
  ] = await Promise.all([
    supabase
      .from('concepts')
      .select('*')
      .eq('subject', subject)
      .ilike('name', `%${topic}%`)
      .limit(5),

    supabase
      .from('concepts')
      .select('*')
      .eq('subject', subject)
      .limit(20),

    supabase
      .from('concepts')
      .select('*')
      .eq('type', 'cross_subject')
      .limit(5),

    supabase
      .from('concept_connections')
      .select('*')
      .in('child_key', [childKey, 'curriculum'])
      .or(`concept_a.ilike.%${topic}%,concept_b.ilike.%${topic}%`)
      .order('created_at', { ascending: false })
      .limit(8),

    supabase
      .from('concept_connections')
      .select('*')
      .in('child_key', [childKey, 'curriculum'])
      .or(`subject_a.eq.${subject},subject_b.eq.${subject}`)
      .order('created_at', { ascending: false })
      .limit(16),

    supabase
      .from('learning_gaps')
      .select('*')
      .eq('child_key', childKey)
      .eq('subject', subject)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(5),

    supabase
      .from('learning_gaps')
      .select('*')
      .eq('child_key', childKey)
      .eq('subject', subject)
      .eq('status', 'resolved')
      .order('resolved_at', { ascending: false })
      .limit(3),
  ])

  const conceptSeen = new Set<string>()
  const related_concepts: Concept[] = []

  function addConcept(c: Concept) {
    if (conceptSeen.has(c.id)) return
    conceptSeen.add(c.id)
    related_concepts.push(c)
  }

  for (const c of topicConcepts ?? []) addConcept(c)
  for (const c of subjectConcepts ?? []) addConcept(c)
  for (const c of crossSubjectConcepts ?? []) addConcept(c)

  const connectionSeen = new Set<string>()
  const prior_connections = [
    ...(topicConnections ?? []),
    ...(subjectConnections ?? []),
  ].filter(c => {
    if (connectionSeen.has(c.id)) return false
    connectionSeen.add(c.id)
    return true
  }).slice(0, 16)

  return {
    related_concepts: related_concepts.slice(0, 15),
    prior_connections,
    open_gaps: open_gaps ?? [],
    resolved_gaps: resolved_gaps ?? [],
  }
}

export function formatContextForPrompt(ctx: TopicGraphContext): string {
  const lines: string[] = []

  if (ctx.open_gaps.length > 0) {
    lines.push('## Known gaps to address in this session')
    ctx.open_gaps.forEach(g => {
      lines.push(`- "${g.concept}" (${g.subject}): ${g.note ?? 'needs reinforcement'}`)
    })
  }

  if (ctx.resolved_gaps.length > 0) {
    lines.push('\n## Concepts recently understood — reinforce but do not re-teach')
    ctx.resolved_gaps.forEach(g => {
      lines.push(`- "${g.concept}" (${g.subject})`)
    })
  }

  if (ctx.related_concepts.length > 0) {
    lines.push('\n## Related concepts in this subject area')
    ctx.related_concepts.forEach(c => {
      lines.push(`- "${c.name}" (${c.subject ?? 'Shared'}) [${c.type}]`)
    })
  }

  if (ctx.prior_connections.length > 0) {
    lines.push('\n## Connections (student notes and school syllabus map)')
    ctx.prior_connections.forEach(c => {
      const tag = c.child_key === 'curriculum' ? '[Syllabus] ' : ''
      lines.push(
        `${tag}"${c.concept_a}" (${c.subject_a ?? '?'}) ${c.relationship} "${c.concept_b}" (${c.subject_b ?? '?'})`
      )
    })
    lines.push(
      'Use these connections to anchor new concepts. Build on bridges the student already sees and align with the syllabus where marked.'
    )
  }

  return lines.join('\n')
}
