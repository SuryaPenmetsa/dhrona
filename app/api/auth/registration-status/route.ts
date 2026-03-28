import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string }
    const email = normalizeEmail(body.email ?? '')
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Provide a valid email.' }, { status: 400 })
    }

    const service = createServiceClient()

    const [{ data: roleRow, error: roleError }, { data: inviteRow, error: inviteError }] = await Promise.all([
      service.from('user_roles').select('user_id').eq('email', email).maybeSingle(),
      service.from('allowed_registrations').select('email').eq('email', email).maybeSingle(),
    ])

    if (roleError || inviteError) {
      throw new Error(roleError?.message ?? inviteError?.message ?? 'Failed to check registration status')
    }

    if (roleRow) {
      return NextResponse.json({ allowed: false, reason: 'already_registered' })
    }

    if (inviteRow) {
      return NextResponse.json({ allowed: true })
    }

    const { count: adminCount, error: adminCountError } = await service
      .from('user_roles')
      .select('user_id', { count: 'exact', head: true })
      .eq('role', 'admin')

    if (adminCountError) {
      throw new Error(adminCountError.message)
    }

    if ((adminCount ?? 0) === 0) {
      return NextResponse.json({ allowed: true, bootstrap: true })
    }

    return NextResponse.json({ allowed: false, reason: 'invite_required' })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to check registration status' },
      { status: 500 }
    )
  }
}
