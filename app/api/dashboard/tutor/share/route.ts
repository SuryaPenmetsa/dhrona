import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

async function requireUserId() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    throw new Error('Authentication required')
  }
  return user.id
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const service = createServiceClient()
    const body = (await request.json()) as { episodeId?: string; targetEmail?: string }
    const episodeId = body.episodeId?.trim()
    const targetEmail = normalizeEmail(body.targetEmail ?? '')

    if (!episodeId) return NextResponse.json({ error: 'Missing episodeId' }, { status: 400 })
    if (!targetEmail || !targetEmail.includes('@')) {
      return NextResponse.json({ error: 'Provide a valid targetEmail.' }, { status: 400 })
    }

    const { data: episode, error: episodeError } = await service
      .from('tutor_chat_episodes')
      .select('id, owner_user_id')
      .eq('id', episodeId)
      .maybeSingle()
    if (episodeError) throw new Error(episodeError.message)
    if (!episode) return NextResponse.json({ error: 'Episode not found' }, { status: 404 })

    const { data: roleRow } = await service.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
    const isAdmin = roleRow?.role === 'admin'
    if (!isAdmin && episode.owner_user_id !== userId) {
      return NextResponse.json({ error: 'Only owner/admin can share this chat.' }, { status: 403 })
    }

    const { data: targetUser, error: targetError } = await service
      .from('user_roles')
      .select('user_id, email')
      .eq('email', targetEmail)
      .maybeSingle()
    if (targetError) throw new Error(targetError.message)
    if (!targetUser?.user_id) {
      return NextResponse.json({ error: 'Target user is not registered yet.' }, { status: 400 })
    }
    if (targetUser.user_id === userId) {
      return NextResponse.json({ error: 'This chat is already visible to you.' }, { status: 400 })
    }

    const { error: shareError } = await service.from('tutor_episode_shares').upsert({
      episode_id: episodeId,
      shared_with_user_id: targetUser.user_id,
      shared_by_user_id: userId,
    })
    if (shareError) throw new Error(shareError.message)

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message === 'Authentication required' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
