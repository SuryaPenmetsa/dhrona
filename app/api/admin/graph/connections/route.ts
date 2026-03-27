import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

function checkAdmin(request: Request): boolean {
  const secret = process.env.WTR_ADMIN_SECRET
  if (!secret) return true
  return request.headers.get('x-admin-secret') === secret
}

export async function DELETE(request: Request) {
  try {
    if (!checkAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const ids: string[] = Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : []

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Provide "id" or "ids" in body' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { error, count } = await supabase
      .from('concept_connections')
      .delete({ count: 'exact' })
      .in('id', ids)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, deleted: count })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    if (!checkAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, relationship } = body as { id?: string; relationship?: string }

    if (!id || !relationship) {
      return NextResponse.json({ error: 'Provide "id" and "relationship" in body' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('concept_connections')
      .update({ relationship })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
