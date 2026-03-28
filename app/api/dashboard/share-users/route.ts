import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

type UserRoleRow = {
  user_id: string
  email: string
}

type InviteRow = {
  email: string
}

type UserProfileRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const service = createServiceClient()
    const [
      { data: users, error: usersError },
      { data: profiles, error: profilesError },
      { data: invites, error: invitesError },
    ] = await Promise.all([
      service.from('user_roles').select('user_id, email').order('email', { ascending: true }),
      service.from('user_profiles').select('user_id, first_name, last_name'),
      service.from('allowed_registrations').select('email').order('email', { ascending: true }),
    ])
    if (usersError || profilesError || invitesError) {
      throw new Error(usersError?.message ?? profilesError?.message ?? invitesError?.message ?? 'Failed to load users')
    }

    const profileByUser = new Map<string, UserProfileRow>()
    for (const row of (profiles ?? []) as UserProfileRow[]) {
      profileByUser.set(row.user_id, row)
    }

    const registeredUsers = ((users ?? []) as UserRoleRow[]).map(row => {
        const profile = profileByUser.get(row.user_id)
        const fullName = [profile?.first_name?.trim(), profile?.last_name?.trim()].filter(Boolean).join(' ')
        return {
          userId: row.user_id,
          email: row.email,
          displayName: fullName || row.email,
          status: row.user_id === user.id ? 'you' : 'registered',
        }
      })

    const existingEmails = new Set(registeredUsers.map(item => item.email.toLowerCase()))
    const pendingInviteUsers = ((invites ?? []) as InviteRow[])
      .map(invite => invite.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email) && !existingEmails.has(email))
      .map(email => ({
        userId: null as string | null,
        email,
        displayName: `${email} (pending invite)`,
        status: 'pending',
      }))

    const shareUsers = [...registeredUsers, ...pendingInviteUsers].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    )

    return NextResponse.json({ users: shareUsers })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
