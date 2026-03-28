import { NextResponse } from 'next/server'
import { AuthzError, requireAdmin, type AppRole } from '@/lib/auth/admin'

type UserRoleRow = {
  user_id: string
  email: string
  role: AppRole
  created_at: string
  first_name: string | null
  last_name: string | null
  learning_profile_id: string | null
}

type AllowRow = {
  email: string
  role: AppRole
  note: string | null
  first_name: string | null
  last_name: string | null
  learning_profile_id: string | null
  created_at: string
}

type UserProfileRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
}

type UserLearningProfileRow = {
  user_id: string
  learning_profile_id: string
}

type LearningProfileOption = {
  id: string
  name: string
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
    const [
      { data: users, error: usersError },
      { data: invites, error: invitesError },
      { data: userProfiles, error: userProfilesError },
      { data: userLearningProfiles, error: userLearningProfilesError },
      { data: learningProfiles, error: learningProfilesError },
    ] = await Promise.all([
      service.from('user_roles').select('user_id, email, role, created_at').order('created_at', { ascending: true }),
      service
        .from('allowed_registrations')
        .select('email, role, note, first_name, last_name, learning_profile_id, created_at')
        .order('created_at', { ascending: false }),
      service.from('user_profiles').select('user_id, first_name, last_name'),
      service.from('user_learning_profiles').select('user_id, learning_profile_id'),
      service.from('learning_profiles').select('id, name').order('name', { ascending: true }),
    ])

    if (usersError || invitesError || userProfilesError || userLearningProfilesError || learningProfilesError) {
      throw new Error(
        usersError?.message ??
          invitesError?.message ??
          userProfilesError?.message ??
          userLearningProfilesError?.message ??
          learningProfilesError?.message ??
          'Failed to load access data'
      )
    }

    const profileByUserId = new Map<string, UserProfileRow>()
    for (const row of (userProfiles ?? []) as UserProfileRow[]) {
      profileByUserId.set(row.user_id, row)
    }

    const learningProfileByUserId = new Map<string, string>()
    for (const row of (userLearningProfiles ?? []) as UserLearningProfileRow[]) {
      learningProfileByUserId.set(row.user_id, row.learning_profile_id)
    }

    const usersWithDetails = ((users ?? []) as Array<Omit<UserRoleRow, 'first_name' | 'last_name' | 'learning_profile_id'>>).map(
      row => ({
        ...row,
        first_name: profileByUserId.get(row.user_id)?.first_name ?? null,
        last_name: profileByUserId.get(row.user_id)?.last_name ?? null,
        learning_profile_id: learningProfileByUserId.get(row.user_id) ?? null,
      })
    )

    return NextResponse.json({
      currentUserId: user.id,
      users: usersWithDetails as UserRoleRow[],
      invites: (invites ?? []) as AllowRow[],
      learningProfiles: (learningProfiles ?? []) as LearningProfileOption[],
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
    const body = (await request.json()) as {
      email?: string
      role?: string
      note?: string
      firstName?: string
      lastName?: string
      learningProfileId?: string | null
    }
    const email = normalizeEmail(body.email ?? '')
    const role = (body.role ?? 'member').trim().toLowerCase()
    const note = body.note?.trim() || null
    const firstName = body.firstName?.trim() || null
    const lastName = body.lastName?.trim() || null
    const learningProfileId = body.learningProfileId?.trim() || null

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
      first_name: firstName,
      last_name: lastName,
      learning_profile_id: learningProfileId,
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
    const body = (await request.json()) as {
      action?: 'updateRole' | 'updateUser' | 'updateInvite'
      userId?: string
      role?: string
      email?: string
      firstName?: string
      lastName?: string
      learningProfileId?: string | null
      resetPassword?: boolean
      oldEmail?: string
      newEmail?: string
      note?: string
      inviteRole?: string
      inviteFirstName?: string
      inviteLastName?: string
      inviteLearningProfileId?: string | null
    }

    if (body.action === 'updateInvite') {
      const oldEmail = normalizeEmail(body.oldEmail ?? '')
      const newEmail = normalizeEmail(body.newEmail ?? '')
      const inviteRole = (body.inviteRole ?? 'member').trim().toLowerCase()
      const note = body.note?.trim() || null
      const firstName = body.inviteFirstName?.trim() || null
      const lastName = body.inviteLastName?.trim() || null
      const learningProfileId = body.inviteLearningProfileId?.trim() || null

      if (!oldEmail || !newEmail) {
        return NextResponse.json({ error: 'Provide oldEmail and newEmail.' }, { status: 400 })
      }
      if (!newEmail.includes('@')) {
        return NextResponse.json({ error: 'Provide a valid email.' }, { status: 400 })
      }
      if (!isValidRole(inviteRole)) {
        return NextResponse.json({ error: 'Role must be admin or member.' }, { status: 400 })
      }

      const { data: roleOwner, error: roleOwnerError } = await service
        .from('user_roles')
        .select('user_id')
        .eq('email', newEmail)
        .maybeSingle()
      if (roleOwnerError) throw new Error(roleOwnerError.message)
      if (roleOwner) {
        return NextResponse.json(
          { error: 'This email is already registered. Edit it from registered users instead.' },
          { status: 400 }
        )
      }

      const { data: inviteOwner, error: inviteOwnerError } = await service
        .from('allowed_registrations')
        .select('email')
        .eq('email', newEmail)
        .maybeSingle()
      if (inviteOwnerError) throw new Error(inviteOwnerError.message)
      if (inviteOwner && newEmail !== oldEmail) {
        return NextResponse.json({ error: 'Another pending invite already uses this email.' }, { status: 400 })
      }

      const { error: upsertError } = await service.from('allowed_registrations').upsert({
        email: newEmail,
        role: inviteRole,
        note,
        first_name: firstName,
        last_name: lastName,
        learning_profile_id: learningProfileId,
        created_by: user.id,
      })
      if (upsertError) throw new Error(upsertError.message)

      if (newEmail !== oldEmail) {
        const { error: deleteOldError } = await service
          .from('allowed_registrations')
          .delete()
          .eq('email', oldEmail)
        if (deleteOldError) throw new Error(deleteOldError.message)
      }

      return NextResponse.json({ ok: true })
    }

    if (body.action === 'updateUser') {
      const userId = body.userId?.trim()
      const email = normalizeEmail(body.email ?? '')
      const firstName = body.firstName?.trim() || null
      const lastName = body.lastName?.trim() || null
      const learningProfileId = body.learningProfileId?.trim() || null
      const shouldResetPassword = body.resetPassword === true

      if (!userId) {
        return NextResponse.json({ error: 'Provide userId.' }, { status: 400 })
      }
      if (!email || !email.includes('@')) {
        return NextResponse.json({ error: 'Provide a valid email.' }, { status: 400 })
      }

      const { data: existingEmailRow, error: existingEmailError } = await service
        .from('user_roles')
        .select('user_id')
        .eq('email', email)
        .neq('user_id', userId)
        .maybeSingle()
      if (existingEmailError) throw new Error(existingEmailError.message)
      if (existingEmailRow) {
        return NextResponse.json({ error: 'That email is already used by another user.' }, { status: 400 })
      }

      const { error: authUpdateError } = await service.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
      })
      if (authUpdateError) throw new Error(authUpdateError.message)

      const { error: roleEmailUpdateError } = await service
        .from('user_roles')
        .update({ email })
        .eq('user_id', userId)
      if (roleEmailUpdateError) throw new Error(roleEmailUpdateError.message)

      const { error: profileUpsertError } = await service.from('user_profiles').upsert({
        user_id: userId,
        first_name: firstName,
        last_name: lastName,
      })
      if (profileUpsertError) throw new Error(profileUpsertError.message)

      if (learningProfileId) {
        const { error: assignmentError } = await service.from('user_learning_profiles').upsert({
          user_id: userId,
          learning_profile_id: learningProfileId,
          assigned_by: user.id,
          assigned_at: new Date().toISOString(),
        })
        if (assignmentError) throw new Error(assignmentError.message)
      } else {
        const { error: assignmentDeleteError } = await service
          .from('user_learning_profiles')
          .delete()
          .eq('user_id', userId)
        if (assignmentDeleteError) throw new Error(assignmentDeleteError.message)
      }

      let tempPassword: string | null = null
      if (shouldResetPassword) {
        tempPassword = `Drona!${Math.random().toString(36).slice(-8)}`
        const { error: passwordError } = await service.auth.admin.updateUserById(userId, {
          password: tempPassword,
        })
        if (passwordError) throw new Error(passwordError.message)
      }

      return NextResponse.json({ ok: true, tempPassword })
    }

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
