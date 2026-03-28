import { NextResponse } from 'next/server'
import { AuthzError, requireAdmin } from '@/lib/auth/admin'

export const runtime = 'nodejs'

export async function DELETE(request: Request) {
  try {
    const { service } = await requireAdmin()

    const body = await request.json()
    const ids: string[] = Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : []

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Provide "id" or "ids" in body' }, { status: 400 })
    }

    const { error, count } = await service
      .from('concept_connections')
      .delete({ count: 'exact' })
      .in('id', ids)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, deleted: count })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const { service } = await requireAdmin()

    const body = await request.json()
    const { id, relationship } = body as { id?: string; relationship?: string }

    if (!id || !relationship) {
      return NextResponse.json({ error: 'Provide "id" and "relationship" in body' }, { status: 400 })
    }

    const { error } = await service
      .from('concept_connections')
      .update({ relationship })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
