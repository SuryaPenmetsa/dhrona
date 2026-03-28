import { NextResponse } from 'next/server'
import { AuthzError, requireAdmin, type AppRole } from '@/lib/auth/admin'

type UserRoleRow = {
  user_id: string
  email: string
  role: AppRole
  created_at: string
}

type AllowRow = {
  email: string
  role: AppRole
  note: string | null
  created_at: string
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function isValidRole(value: string): value is AppRole {
  return value === 'admin' || value === 'member'
}

export async function GET() {
  try {
    const { user, service } = await requireAdmin()
    const [{ data: users, error: usersError }, { data: invites, error: invitesError }] = await Promise.all([
      service.from('user_roles').select('user_id, email, role, created_at').order('created_at', { ascending: true }),
      service
        .from('allowed_registrations')
        .select('email, role, note, created_at')
        .order('created_at', { ascending: false }),
    ])

    if (usersError || invitesError) {
      throw new Error(usersError?.message ?? invitesError?.message ?? 'Failed to load access data')
    }

    return NextResponse.json({
      currentUserId: user.id,
      users: (users ?? []) as UserRoleRow[],
      invites: (invites ?? []) as AllowRow[],
    })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load access data' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { user, service } = await requireAdmin()
    const body = (await request.json()) as { email?: string; role?: string; note?: string }
    const email = normalizeEmail(body.email ?? '')
    const role = (body.role ?? 'member').trim().toLowerCase()
    const note = body.note?.trim() || null

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Provide a valid email.' }, { status: 400 })
    }
    if (!isValidRole(role)) {
      return NextResponse.json({ error: 'Role must be admin or member.' }, { status: 400 })
    }

    const { error } = await service.from('allowed_registrations').upsert({
      email,
      role,
      note,
      created_by: user.id,
    })
    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create invite' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, service } = await requireAdmin()
    const body = (await request.json()) as { userId?: string; role?: string }
    const userId = body.userId?.trim()
    const role = (body.role ?? '').trim().toLowerCase()

    if (!userId) {
      return NextResponse.json({ error: 'Provide userId.' }, { status: 400 })
    }
    if (!isValidRole(role)) {
      return NextResponse.json({ error: 'Role must be admin or member.' }, { status: 400 })
    }

    // Avoid locking the app by demoting the last admin.
    if (role !== 'admin') {
      const { count, error: adminCountError } = await service
        .from('user_roles')
        .select('user_id', { count: 'exact', head: true })
        .eq('role', 'admin')
      if (adminCountError) throw new Error(adminCountError.message)
      const { data: targetRole, error: targetRoleError } = await service
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle()
      if (targetRoleError) throw new Error(targetRoleError.message)
      if (targetRole?.role === 'admin' && (count ?? 0) <= 1) {
        return NextResponse.json({ error: 'At least one admin must remain.' }, { status: 400 })
      }
    }

    const { error } = await service.from('user_roles').update({ role }).eq('user_id', userId)
    if (error) throw new Error(error.message)

    // If admin demotes themselves, it should still work but they lose access next request.
    return NextResponse.json({ ok: true, selfUpdated: userId === user.id })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update role' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { service } = await requireAdmin()
    const body = (await request.json()) as { email?: string }
    const email = normalizeEmail(body.email ?? '')
    if (!email) {
      return NextResponse.json({ error: 'Provide email.' }, { status: 400 })
    }

    const { error } = await service.from('allowed_registrations').delete().eq('email', email)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to remove invite' },
      { status: 500 }
    )
  }
}
