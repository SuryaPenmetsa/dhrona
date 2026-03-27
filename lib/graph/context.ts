import { createClient } from '@/lib/supabase/server'
import type { ChildKey, TopicGraphContext } from './types'

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

  // Concepts related to this subject
  const { data: related_concepts } = await supabase
    .from('concepts')
    .select('*')
    .eq('subject', subject)
    .limit(10)

  // Child-specific + school curriculum (WTR) edges for this subject
  const { data: prior_connections } = await supabase
    .from('concept_connections')
    .select('*')
    .in('child_key', [childKey, 'curriculum'])
    .or(`subject_a.eq.${subject},subject_b.eq.${subject}`)
    .order('created_at', { ascending: false })
    .limit(12)

  // Open gaps for this child in this subject
  const { data: open_gaps } = await supabase
    .from('learning_gaps')
    .select('*')
    .eq('child_key', childKey)
    .eq('subject', subject)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(5)

  // Recently resolved gaps (so AI can reinforce what was just learned)
  const { data: resolved_gaps } = await supabase
    .from('learning_gaps')
    .select('*')
    .eq('child_key', childKey)
    .eq('subject', subject)
    .eq('status', 'resolved')
    .order('resolved_at', { ascending: false })
    .limit(3)

  return {
    related_concepts: related_concepts ?? [],
    prior_connections: prior_connections ?? [],
    open_gaps: open_gaps ?? [],
    resolved_gaps: resolved_gaps ?? [],
  }
}

// Format context as a string block for injection into system prompt
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
