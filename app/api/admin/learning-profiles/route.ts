import { NextResponse } from 'next/server'
import { AuthzError, requireAdmin } from '@/lib/auth/admin'

type LearningProfileRow = {
  id: string
  name: string
  personality_summary: string | null
  llm_instructions_rich_text: string
  suggestion_question_instructions_rich_text: string
  created_at: string
  updated_at: string
}

type UserRoleRow = {
  user_id: string
  email: string
  role: 'admin' | 'member'
}

type AssignmentRow = {
  user_id: string
  learning_profile_id: string
  assigned_at: string
}

type PendingInviteRow = {
  email: string
  role: 'admin' | 'member'
  first_name: string | null
  last_name: string | null
  learning_profile_id: string | null
}

function normalizeText(value: string | undefined | null) {
  const next = value?.trim()
  return next ? next : null
}

export async function GET() {
  try {
    const { service } = await requireAdmin()
    const [
      { data: profiles, error: profilesError },
      { data: users, error: usersError },
      { data: assignments, error: assignmentsError },
      { data: pendingInvites, error: pendingInvitesError },
    ] = await Promise.all([
      service
        .from('learning_profiles')
        .select(
          'id, name, personality_summary, llm_instructions_rich_text, suggestion_question_instructions_rich_text, created_at, updated_at'
        )
        .order('name', { ascending: true }),
      service.from('user_roles').select('user_id, email, role').order('email', { ascending: true }),
      service.from('user_learning_profiles').select('user_id, learning_profile_id, assigned_at'),
      service
        .from('allowed_registrations')
        .select('email, role, first_name, last_name, learning_profile_id')
        .order('created_at', { ascending: false }),
    ])

    if (profilesError || usersError || assignmentsError || pendingInvitesError) {
      throw new Error(
        profilesError?.message ??
          usersError?.message ??
          assignmentsError?.message ??
          pendingInvitesError?.message ??
          'Failed to load learning profiles'
      )
    }

    return NextResponse.json({
      profiles: (profiles ?? []) as LearningProfileRow[],
      users: ((users ?? []) as UserRoleRow[]).filter(user => user.role === 'member'),
      assignments: (assignments ?? []) as AssignmentRow[],
      pendingInvites: ((pendingInvites ?? []) as PendingInviteRow[]).filter(invite => invite.role === 'member'),
    })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load learning profiles' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { user, service } = await requireAdmin()
    const body = (await request.json()) as {
      name?: string
      personalitySummary?: string
      llmInstructionsRichText?: string
      suggestionQuestionInstructionsRichText?: string
    }
    const name = body.name?.trim()
    const personalitySummary = normalizeText(body.personalitySummary)
    const llmInstructionsRichText = body.llmInstructionsRichText?.trim() ?? ''
    const suggestionQuestionInstructionsRichText = body.suggestionQuestionInstructionsRichText?.trim() ?? ''

    if (!name) {
      return NextResponse.json({ error: 'Provide a profile name.' }, { status: 400 })
    }
    if (!llmInstructionsRichText) {
      return NextResponse.json({ error: 'Provide LLM instructions.' }, { status: 400 })
    }

    const { data, error } = await service
      .from('learning_profiles')
      .insert({
        name,
        personality_summary: personalitySummary,
        llm_instructions_rich_text: llmInstructionsRichText,
        suggestion_question_instructions_rich_text: suggestionQuestionInstructionsRichText,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create learning profile' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, service } = await requireAdmin()
    const body = (await request.json()) as Record<string, unknown>

    if (body.action === 'assignProfile') {
      const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : ''
      const inviteEmail = typeof body.inviteEmail === 'string' ? body.inviteEmail.trim().toLowerCase() : ''
      const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : null

      if (!targetUserId && !inviteEmail) {
        return NextResponse.json({ error: 'Provide targetUserId or inviteEmail.' }, { status: 400 })
      }

      if (targetUserId) {
        if (!profileId) {
          const { error } = await service.from('user_learning_profiles').delete().eq('user_id', targetUserId)
          if (error) throw new Error(error.message)
          return NextResponse.json({ ok: true, cleared: true })
        }

        const { error } = await service.from('user_learning_profiles').upsert({
          user_id: targetUserId,
          learning_profile_id: profileId,
          assigned_by: user.id,
          assigned_at: new Date().toISOString(),
        })
        if (error) throw new Error(error.message)
      }

      if (inviteEmail) {
        const { error } = await service
          .from('allowed_registrations')
          .update({ learning_profile_id: profileId })
          .eq('email', inviteEmail)
        if (error) throw new Error(error.message)
      }

      return NextResponse.json({ ok: true })
    }

    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const personalitySummary = normalizeText(typeof body.personalitySummary === 'string' ? body.personalitySummary : null)
    const llmInstructionsRichText =
      typeof body.llmInstructionsRichText === 'string' ? body.llmInstructionsRichText.trim() : ''
    const suggestionQuestionInstructionsRichText =
      typeof body.suggestionQuestionInstructionsRichText === 'string'
        ? body.suggestionQuestionInstructionsRichText.trim()
        : ''

    if (!profileId) {
      return NextResponse.json({ error: 'Provide profileId.' }, { status: 400 })
    }
    if (!name) {
      return NextResponse.json({ error: 'Provide a profile name.' }, { status: 400 })
    }
    if (!llmInstructionsRichText) {
      return NextResponse.json({ error: 'Provide LLM instructions.' }, { status: 400 })
    }

    const { error } = await service
      .from('learning_profiles')
      .update({
        name,
        personality_summary: personalitySummary,
        llm_instructions_rich_text: llmInstructionsRichText,
        suggestion_question_instructions_rich_text: suggestionQuestionInstructionsRichText,
      })
      .eq('id', profileId)
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update learning profile' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { service } = await requireAdmin()
    const body = (await request.json()) as { profileId?: string }
    const profileId = body.profileId?.trim()
    if (!profileId) {
      return NextResponse.json({ error: 'Provide profileId.' }, { status: 400 })
    }

    const { error } = await service.from('learning_profiles').delete().eq('id', profileId)
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete learning profile' },
      { status: 500 }
    )
  }
}
