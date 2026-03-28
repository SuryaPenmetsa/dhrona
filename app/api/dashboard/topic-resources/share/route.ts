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
    const body = (await request.json()) as { resourceId?: string; targetEmail?: string; targetUserId?: string }
    const resourceId = body.resourceId?.trim()
    const targetUserId = body.targetUserId?.trim()
    const targetEmail = normalizeEmail(body.targetEmail ?? '')

    if (!resourceId) return NextResponse.json({ error: 'Missing resourceId' }, { status: 400 })
    if (!targetUserId && (!targetEmail || !targetEmail.includes('@'))) {
      return NextResponse.json({ error: 'Provide targetUserId or a valid targetEmail.' }, { status: 400 })
    }

    const { data: resource, error: resourceError } = await service
      .from('topic_resources')
      .select('id, created_by')
      .eq('id', resourceId)
      .maybeSingle()
    if (resourceError) throw new Error(resourceError.message)
    if (!resource) return NextResponse.json({ error: 'Resource not found' }, { status: 404 })

    const { data: roleRow } = await service.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
    const isAdmin = roleRow?.role === 'admin'
    if (!isAdmin && resource.created_by !== userId) {
      return NextResponse.json({ error: 'Only owner/admin can share this resource.' }, { status: 403 })
    }

    let targetUser:
      | {
          user_id: string
          email: string
        }
      | null = null

    if (targetUserId) {
      const { data, error: targetError } = await service
        .from('user_roles')
        .select('user_id, email')
        .eq('user_id', targetUserId)
        .maybeSingle()
      if (targetError) throw new Error(targetError.message)
      targetUser = data
    } else {
      const { data, error: targetError } = await service
        .from('user_roles')
        .select('user_id, email')
        .eq('email', targetEmail)
        .maybeSingle()
      if (targetError) throw new Error(targetError.message)
      targetUser = data
    }
    if (!targetUser?.user_id) {
      return NextResponse.json({ error: 'Target user is not registered yet.' }, { status: 400 })
    }
    if (targetUser.user_id === userId) {
      return NextResponse.json({ error: 'Resource is already visible to you.' }, { status: 400 })
    }

    const { error: shareError } = await service.from('topic_resource_shares').upsert({
      resource_id: resourceId,
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
