import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

type TutorRole = 'user' | 'assistant'

type TutorRequest = {
  episodeId?: string
  mapTopic?: {
    title?: string
    subject?: string | null
  }
  node?: {
    name?: string
    subject?: string | null
    kind?: 'focus' | 'upstream' | 'downstream'
  }
  question?: string
  history?: Array<{ role?: TutorRole; content?: string }>
  context?: {
    upstream?: string[]
    downstream?: string[]
    relatedEdges?: string[]
  }
}

type PersistedMessageRow = {
  id: string
  role: TutorRole
  content: string
  created_at: string
}

type EpisodeRow = {
  id: string
  child_key: string
  map_topic: string
  map_subject: string | null
  node_name: string
  node_subject: string | null
}

type LearningProfileRow = {
  id: string
  name: string
  llm_instructions_rich_text: string
}

function fallbackTutorReply(payload: TutorRequest): string {
  const node = payload.node?.name?.trim() || payload.mapTopic?.title?.trim() || 'this concept'
  const subject = payload.node?.subject?.trim() || payload.mapTopic?.subject?.trim() || 'the current subject'
  const upstream = (payload.context?.upstream ?? []).slice(0, 4)
  const downstream = (payload.context?.downstream ?? []).slice(0, 4)
  const question = payload.question?.trim() || `Help me understand ${node}`

  const chunks = [
    `Let's break down ${node} in ${subject}.`,
    `Question focus: "${question}"`,
  ]
  if (upstream.length > 0) {
    chunks.push(`Before this, make sure you understand: ${upstream.join(', ')}.`)
  }
  if (downstream.length > 0) {
    chunks.push(`This concept helps you with: ${downstream.join(', ')}.`)
  }
  chunks.push(
    'Try this mini-plan: 1) one-sentence definition, 2) one concrete example, 3) one check-yourself question.'
  )
  return chunks.join('\n\n')
}

function normalizeNullableText(value: string | null | undefined) {
  const next = value?.trim()
  return next ? next : null
}

function sameNullableText(a: string | null, b: string | null) {
  return (a ?? '') === (b ?? '')
}

async function resolveLearningProfileForCurrentUser() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const service = createServiceClient()
    const { data: assignment, error: assignmentError } = await service
      .from('user_learning_profiles')
      .select('learning_profile_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (assignmentError || !assignment?.learning_profile_id) {
      return null
    }

    const { data: profile, error: profileError } = await service
      .from('learning_profiles')
      .select('id, name, llm_instructions_rich_text')
      .eq('id', assignment.learning_profile_id)
      .maybeSingle()

    if (profileError || !profile?.llm_instructions_rich_text?.trim()) {
      return null
    }

    return profile as LearningProfileRow
  } catch {
    return null
  }
}

async function resolveEpisodeId({
  requestedEpisodeId,
  mapTopic,
  mapSubject,
  nodeName,
  nodeSubject,
}: {
  requestedEpisodeId?: string
  mapTopic: string
  mapSubject: string | null
  nodeName: string
  nodeSubject: string | null
}) {
  const supabase = createServiceClient()

  if (requestedEpisodeId) {
    const { data } = await supabase
      .from('tutor_chat_episodes')
      .select('id')
      .eq('id', requestedEpisodeId)
      .maybeSingle()
    if (data?.id) return data.id
  }

  const { data: candidates } = await supabase
    .from('tutor_chat_episodes')
    .select('id, map_subject, node_subject')
    .eq('child_key', 'curriculum')
    .eq('map_topic', mapTopic)
    .eq('node_name', nodeName)
    .limit(30)

  const exact = (candidates ?? []).find(item =>
    sameNullableText(item.map_subject, mapSubject) && sameNullableText(item.node_subject, nodeSubject)
  )
  if (exact?.id) return exact.id

  const { data: inserted, error: insertError } = await supabase
    .from('tutor_chat_episodes')
    .insert({
      child_key: 'curriculum',
      map_topic: mapTopic,
      map_subject: mapSubject,
      node_name: nodeName,
      node_subject: nodeSubject,
    })
    .select('id')
    .single()
  if (insertError) throw new Error(insertError.message)
  return inserted.id
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mapTopic = searchParams.get('map_topic')?.trim()
    const nodeName = searchParams.get('node_name')?.trim()
    const mapSubject = normalizeNullableText(searchParams.get('map_subject'))
    const nodeSubject = normalizeNullableText(searchParams.get('node_subject'))

    if (!mapTopic || !nodeName) {
      return NextResponse.json({ error: 'Missing map_topic or node_name' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: episodes, error: episodeError } = await supabase
      .from('tutor_chat_episodes')
      .select('id, child_key, map_topic, map_subject, node_name, node_subject')
      .eq('child_key', 'curriculum')
      .eq('map_topic', mapTopic)
      .eq('node_name', nodeName)
      .limit(30)

    if (episodeError) {
      throw new Error(episodeError.message)
    }

    const episode = ((episodes ?? []) as EpisodeRow[]).find(
      item => sameNullableText(item.map_subject, mapSubject) && sameNullableText(item.node_subject, nodeSubject)
    )

    if (!episode) {
      return NextResponse.json({ episodeId: null, messages: [] })
    }

    const { data: messages, error: messageError } = await supabase
      .from('tutor_chat_messages')
      .select('id, role, content, created_at')
      .eq('episode_id', episode.id)
      .order('created_at', { ascending: true })

    if (messageError) {
      throw new Error(messageError.message)
    }

    return NextResponse.json({
      episodeId: episode.id,
      messages: (messages ?? []) as PersistedMessageRow[],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const episodeId = searchParams.get('episode_id')?.trim()
    if (!episodeId) {
      return NextResponse.json({ error: 'Missing episode_id' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase.from('tutor_chat_episodes').delete().eq('id', episodeId)
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TutorRequest
    const question = body.question?.trim()
    const nodeName = body.node?.name?.trim()
    if (!question) {
      return NextResponse.json({ error: 'Missing question' }, { status: 400 })
    }
    if (!nodeName) {
      return NextResponse.json({ error: 'Missing node name' }, { status: 400 })
    }

    const mapTopic = body.mapTopic?.title?.trim() || nodeName
    const mapSubject = normalizeNullableText(body.mapTopic?.subject)
    const nodeSubject = normalizeNullableText(body.node?.subject)
    const nodeKind = body.node?.kind ?? 'focus'
    const upstream = (body.context?.upstream ?? []).slice(0, 8)
    const downstream = (body.context?.downstream ?? []).slice(0, 8)
    const relatedEdges = (body.context?.relatedEdges ?? []).slice(0, 10)

    let episodeId: string | null = null
    try {
      episodeId = await resolveEpisodeId({
        requestedEpisodeId: body.episodeId,
        mapTopic,
        mapSubject,
        nodeName,
        nodeSubject,
      })
    } catch (episodeErr) {
      console.error('[tutor] episode resolve failed:', episodeErr)
    }

    const fallbackAnswer = fallbackTutorReply(body)
    let answer = fallbackAnswer
    let fallback = true

    if (process.env.ANTHROPIC_API_KEY) {
      const learningProfile = await resolveLearningProfileForCurrentUser()
      const systemInstruction =
        'You are Tutor, an expert and friendly learning coach inside an educational concept map. ' +
        'Give concise, clear explanations and guide the learner step by step. ' +
        'Use plain language, short paragraphs, and include one quick check question at the end. ' +
        'If relevant, connect to prerequisites and next concepts from the map context.' +
        (learningProfile
          ? `\n\nLearner profile (${learningProfile.name}) instructions:\n${learningProfile.llm_instructions_rich_text}`
          : '')

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const history = (body.history ?? [])
        .filter(item => (item.role === 'user' || item.role === 'assistant') && item.content?.trim())
        .slice(-8)
        .map(item => ({
          role: item.role as TutorRole,
          content: item.content!.trim(),
        }))

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 700,
        system: systemInstruction,
        messages: [
          {
            role: 'user',
            content: `Map context:
- Active map topic: ${mapTopic}
- Map subject: ${mapSubject ?? 'Unknown subject'}
- Selected node: ${nodeName}
- Selected node subject: ${nodeSubject ?? 'Unknown subject'}
- Node role in chain: ${nodeKind}
- Upstream prerequisites: ${upstream.length ? upstream.join(', ') : 'None listed'}
- Downstream concepts: ${downstream.length ? downstream.join(', ') : 'None listed'}
- Connected relationships: ${relatedEdges.length ? relatedEdges.join(' | ') : 'None listed'}

Recent conversation:
${history.map(item => `${item.role === 'assistant' ? 'Tutor' : 'Learner'}: ${item.content}`).join('\n') || 'No prior messages.'}

Learner message:
${question}

Respond as Tutor in a practical, encouraging style.`,
          },
        ],
      })

      const generated = response.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n')
        .trim()

      if (generated) {
        answer = generated
        fallback = false
      }
    }

    if (episodeId) {
      try {
        const supabase = createServiceClient()
        const { error: messageInsertError } = await supabase.from('tutor_chat_messages').insert([
          {
            episode_id: episodeId,
            role: 'user',
            content: question,
            context: body.context ?? {},
          },
          {
            episode_id: episodeId,
            role: 'assistant',
            content: answer,
            context: body.context ?? {},
          },
        ])
        if (messageInsertError) {
          throw new Error(messageInsertError.message)
        }

        const nowIso = new Date().toISOString()
        const { error: episodeUpdateError } = await supabase
          .from('tutor_chat_episodes')
          .update({
            node_kind: nodeKind,
            updated_at: nowIso,
            last_message_at: nowIso,
          })
          .eq('id', episodeId)
        if (episodeUpdateError) {
          throw new Error(episodeUpdateError.message)
        }
      } catch (persistErr) {
        console.error('[tutor] message persistence failed:', persistErr)
      }
    }

    return NextResponse.json({ answer, fallback, episodeId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ answer: `Tutor is unavailable right now (${message}).`, fallback: true })
  }
}
