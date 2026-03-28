'use client'

import { useCallback, useEffect, useState } from 'react'
import AdminModuleNav from '@/components/navigation/AdminModuleNav'

type AppRole = 'admin' | 'member'

type UserRoleRow = {
  user_id: string
  email: string
  role: AppRole
  created_at: string
  first_name: string | null
  last_name: string | null
  learning_profile_id: string | null
}

type InviteRow = {
  email: string
  role: AppRole
  note: string | null
  first_name: string | null
  last_name: string | null
  learning_profile_id: string | null
  created_at: string
}

type AccessPayload = {
  currentUserId: string
  users: UserRoleRow[]
  invites: InviteRow[]
  learningProfiles: Array<{ id: string; name: string }>
}

export default function AdminAccessPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<AccessPayload | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<AppRole>('member')
  const [inviteNote, setInviteNote] = useState('')
  const [inviteFirstName, setInviteFirstName] = useState('')
  const [inviteLastName, setInviteLastName] = useState('')
  const [inviteLearningProfileId, setInviteLearningProfileId] = useState('')
  const [savingInvite, setSavingInvite] = useState(false)
  const [inviteEdits, setInviteEdits] = useState<
    Record<
      string,
      {
        newEmail: string
        role: AppRole
        note: string
        firstName: string
        lastName: string
        learningProfileId: string
      }
    >
  >({})
  const [savingInviteEmail, setSavingInviteEmail] = useState<string | null>(null)
  const [userEdits, setUserEdits] = useState<
    Record<
      string,
      {
        email: string
        firstName: string
        lastName: string
        learningProfileId: string
      }
    >
  >({})
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/access')
      const data = (await res.json()) as AccessPayload & { error?: string }
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      setPayload(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin access data.')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!payload) {
      setInviteEdits({})
      return
    }
    const next: Record<
      string,
      {
        newEmail: string
        role: AppRole
        note: string
        firstName: string
        lastName: string
        learningProfileId: string
      }
    > = {}
    for (const invite of payload.invites) {
      next[invite.email] = {
        newEmail: invite.email,
        role: invite.role,
        note: invite.note ?? '',
        firstName: invite.first_name ?? '',
        lastName: invite.last_name ?? '',
        learningProfileId: invite.learning_profile_id ?? '',
      }
    }
    setInviteEdits(next)
  }, [payload])

  useEffect(() => {
    if (!payload) {
      setUserEdits({})
      return
    }
    const next: Record<
      string,
      {
        email: string
        firstName: string
        lastName: string
        learningProfileId: string
      }
    > = {}
    for (const row of payload.users) {
      next[row.user_id] = {
        email: row.email,
        firstName: row.first_name ?? '',
        lastName: row.last_name ?? '',
        learningProfileId: row.learning_profile_id ?? '',
      }
    }
    setUserEdits(next)
  }, [payload])

  async function addInvite(event: React.FormEvent) {
    event.preventDefault()
    setSavingInvite(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          note: inviteNote,
          firstName: inviteFirstName,
          lastName: inviteLastName,
          learningProfileId: inviteLearningProfileId || null,
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not add invite.')
      setInviteEmail('')
      setInviteNote('')
      setInviteRole('member')
      setInviteFirstName('')
      setInviteLastName('')
      setInviteLearningProfileId('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add invite.')
    } finally {
      setSavingInvite(false)
    }
  }

  async function removeInvite(email: string) {
    try {
      const res = await fetch('/api/admin/access', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not remove invite.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove invite.')
    }
  }

  async function updateInvite(oldEmail: string) {
    const draft = inviteEdits[oldEmail]
    if (!draft) return
    setSavingInviteEmail(oldEmail)
    setError(null)
    try {
      const res = await fetch('/api/admin/access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateInvite',
          oldEmail,
          newEmail: draft.newEmail,
          inviteRole: draft.role,
          note: draft.note,
          inviteFirstName: draft.firstName,
          inviteLastName: draft.lastName,
          inviteLearningProfileId: draft.learningProfileId || null,
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not update invite.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update invite.')
    } finally {
      setSavingInviteEmail(null)
    }
  }

  async function updateRole(userId: string, role: AppRole) {
    try {
      const res = await fetch('/api/admin/access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateRole', userId, role }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not update role.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update role.')
    }
  }

  async function saveUser(userId: string, resetPassword: boolean) {
    const draft = userEdits[userId]
    if (!draft) return
    setSavingUserId(userId)
    setError(null)
    try {
      const res = await fetch('/api/admin/access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateUser',
          userId,
          email: draft.email,
          firstName: draft.firstName,
          lastName: draft.lastName,
          learningProfileId: draft.learningProfileId || null,
          resetPassword,
        }),
      })
      const data = (await res.json()) as { error?: string; tempPassword?: string | null }
      if (!res.ok) throw new Error(data.error ?? 'Could not save user.')
      if (data.tempPassword) {
        setTempPasswords(prev => ({ ...prev, [userId]: data.tempPassword! }))
      } else {
        setTempPasswords(prev => {
          const next = { ...prev }
          delete next[userId]
          return next
        })
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save user.')
    } finally {
      setSavingUserId(null)
    }
  }

  return (
    <main>
      <AdminModuleNav />

      <h1>Admin access control</h1>
      <p className="lead">
        User registration is controlled here: approve invite emails, then assign admin/member roles.
      </p>

      {error ? (
        <section className="card">
          <p className="err" style={{ margin: 0 }}>
            {error}
          </p>
        </section>
      ) : null}

      <section className="card">
        <h2 className="graph-section-title">Allow new registration</h2>
        <form className="access-form-grid" onSubmit={addInvite} style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr)) auto' }}>
          <div>
            <label htmlFor="invite-email">Email</label>
            <input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={event => setInviteEmail(event.target.value)}
              placeholder="name@example.com"
              required
            />
          </div>
          <div>
            <label htmlFor="invite-role">Role</label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={event => setInviteRole(event.target.value as AppRole)}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label htmlFor="invite-note">Note</label>
            <input
              id="invite-note"
              type="text"
              value={inviteNote}
              onChange={event => setInviteNote(event.target.value)}
              placeholder="Optional label"
            />
          </div>
          <div>
            <label htmlFor="invite-first-name">First name</label>
            <input
              id="invite-first-name"
              type="text"
              value={inviteFirstName}
              onChange={event => setInviteFirstName(event.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <label htmlFor="invite-last-name">Last name</label>
            <input
              id="invite-last-name"
              type="text"
              value={inviteLastName}
              onChange={event => setInviteLastName(event.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <label htmlFor="invite-learning-profile">Learning profile</label>
            <select
              id="invite-learning-profile"
              value={inviteLearningProfileId}
              onChange={event => setInviteLearningProfileId(event.target.value)}
            >
              <option value="">No profile</option>
              {payload?.learningProfiles.map(profile => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
          <div className="access-form-action">
            <button className="primary" type="submit" disabled={savingInvite}>
              {savingInvite ? 'Saving...' : 'Add invite'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="graph-section-title">Pending invites</h2>
        <p className="lead" style={{ marginTop: 0 }}>
          You can fully edit pending users before they sign in. These details are applied automatically at first signup.
        </p>
        {loading ? (
          <p className="lead" style={{ margin: 0 }}>
            Loading...
          </p>
        ) : !payload || payload.invites.length === 0 ? (
          <p className="lead" style={{ margin: 0 }}>
            No pending invites.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role on signup</th>
                <th>First name</th>
                <th>Last name</th>
                <th>Learning profile</th>
                <th>Note</th>
                <th>Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payload.invites.map(invite => (
                <tr key={invite.email}>
                  <td>
                    <input
                      type="email"
                      value={inviteEdits[invite.email]?.newEmail ?? invite.email}
                      onChange={event =>
                        setInviteEdits(prev => ({
                          ...prev,
                          [invite.email]: {
                            ...(prev[invite.email] ?? {
                              newEmail: invite.email,
                              role: invite.role,
                              note: invite.note ?? '',
                              firstName: invite.first_name ?? '',
                              lastName: invite.last_name ?? '',
                              learningProfileId: invite.learning_profile_id ?? '',
                            }),
                            newEmail: event.target.value,
                          },
                        }))
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={inviteEdits[invite.email]?.role ?? invite.role}
                      onChange={event =>
                        setInviteEdits(prev => ({
                          ...prev,
                          [invite.email]: {
                            ...(prev[invite.email] ?? {
                              newEmail: invite.email,
                              role: invite.role,
                              note: invite.note ?? '',
                              firstName: invite.first_name ?? '',
                              lastName: invite.last_name ?? '',
                              learningProfileId: invite.learning_profile_id ?? '',
                            }),
                            role: event.target.value as AppRole,
                          },
                        }))
                      }
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={inviteEdits[invite.email]?.firstName ?? invite.first_name ?? ''}
                      onChange={event =>
                        setInviteEdits(prev => ({
                          ...prev,
                          [invite.email]: {
                            ...(prev[invite.email] ?? {
                              newEmail: invite.email,
                              role: invite.role,
                              note: invite.note ?? '',
                              firstName: invite.first_name ?? '',
                              lastName: invite.last_name ?? '',
                              learningProfileId: invite.learning_profile_id ?? '',
                            }),
                            firstName: event.target.value,
                          },
                        }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={inviteEdits[invite.email]?.lastName ?? invite.last_name ?? ''}
                      onChange={event =>
                        setInviteEdits(prev => ({
                          ...prev,
                          [invite.email]: {
                            ...(prev[invite.email] ?? {
                              newEmail: invite.email,
                              role: invite.role,
                              note: invite.note ?? '',
                              firstName: invite.first_name ?? '',
                              lastName: invite.last_name ?? '',
                              learningProfileId: invite.learning_profile_id ?? '',
                            }),
                            lastName: event.target.value,
                          },
                        }))
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={inviteEdits[invite.email]?.learningProfileId ?? invite.learning_profile_id ?? ''}
                      onChange={event =>
                        setInviteEdits(prev => ({
                          ...prev,
                          [invite.email]: {
                            ...(prev[invite.email] ?? {
                              newEmail: invite.email,
                              role: invite.role,
                              note: invite.note ?? '',
                              firstName: invite.first_name ?? '',
                              lastName: invite.last_name ?? '',
                              learningProfileId: invite.learning_profile_id ?? '',
                            }),
                            learningProfileId: event.target.value,
                          },
                        }))
                      }
                    >
                      <option value="">No profile</option>
                      {payload.learningProfiles.map(profile => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={inviteEdits[invite.email]?.note ?? invite.note ?? ''}
                      onChange={event =>
                        setInviteEdits(prev => ({
                          ...prev,
                          [invite.email]: {
                            ...(prev[invite.email] ?? {
                              newEmail: invite.email,
                              role: invite.role,
                              note: invite.note ?? '',
                              firstName: invite.first_name ?? '',
                              lastName: invite.last_name ?? '',
                              learningProfileId: invite.learning_profile_id ?? '',
                            }),
                            note: event.target.value,
                          },
                        }))
                      }
                    />
                  </td>
                  <td>{new Date(invite.created_at).toLocaleString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="dash-reset-btn"
                        disabled={savingInviteEmail === invite.email}
                        onClick={() => void updateInvite(invite.email)}
                      >
                        {savingInviteEmail === invite.email ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="graph-action-btn graph-action-btn-danger"
                        onClick={() => void removeInvite(invite.email)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 className="graph-section-title">Registered users</h2>
        <p className="lead" style={{ marginTop: 0 }}>
          Edit user identity, role, and learning profile. Use "Save + Reset password" to generate a temporary password.
        </p>
        {loading ? (
          <p className="lead" style={{ margin: 0 }}>
            Loading...
          </p>
        ) : !payload || payload.users.length === 0 ? (
          <p className="lead" style={{ margin: 0 }}>
            No users found.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>First name</th>
                <th>Last name</th>
                <th>Learning profile</th>
                <th>Role</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payload.users.map(row => (
                <tr key={row.user_id}>
                  <td>
                    <input
                      type="email"
                      value={userEdits[row.user_id]?.email ?? row.email}
                      onChange={event =>
                        setUserEdits(prev => ({
                          ...prev,
                          [row.user_id]: {
                            ...(prev[row.user_id] ?? {
                              email: row.email,
                              firstName: row.first_name ?? '',
                              lastName: row.last_name ?? '',
                              learningProfileId: row.learning_profile_id ?? '',
                            }),
                            email: event.target.value,
                          },
                        }))
                      }
                    />
                    <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--muted)' }}>
                      {row.user_id === payload.currentUserId ? 'Current admin user' : 'Member account'}
                    </div>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={userEdits[row.user_id]?.firstName ?? row.first_name ?? ''}
                      onChange={event =>
                        setUserEdits(prev => ({
                          ...prev,
                          [row.user_id]: {
                            ...(prev[row.user_id] ?? {
                              email: row.email,
                              firstName: row.first_name ?? '',
                              lastName: row.last_name ?? '',
                              learningProfileId: row.learning_profile_id ?? '',
                            }),
                            firstName: event.target.value,
                          },
                        }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={userEdits[row.user_id]?.lastName ?? row.last_name ?? ''}
                      onChange={event =>
                        setUserEdits(prev => ({
                          ...prev,
                          [row.user_id]: {
                            ...(prev[row.user_id] ?? {
                              email: row.email,
                              firstName: row.first_name ?? '',
                              lastName: row.last_name ?? '',
                              learningProfileId: row.learning_profile_id ?? '',
                            }),
                            lastName: event.target.value,
                          },
                        }))
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={userEdits[row.user_id]?.learningProfileId ?? row.learning_profile_id ?? ''}
                      onChange={event =>
                        setUserEdits(prev => ({
                          ...prev,
                          [row.user_id]: {
                            ...(prev[row.user_id] ?? {
                              email: row.email,
                              firstName: row.first_name ?? '',
                              lastName: row.last_name ?? '',
                              learningProfileId: row.learning_profile_id ?? '',
                            }),
                            learningProfileId: event.target.value,
                          },
                        }))
                      }
                    >
                      <option value="">No profile</option>
                      {payload.learningProfiles.map(profile => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={row.role} onChange={event => void updateRole(row.user_id, event.target.value as AppRole)}>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td style={{ minWidth: 260 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="dash-reset-btn"
                        disabled={savingUserId === row.user_id}
                        onClick={() => void saveUser(row.user_id, false)}
                      >
                        {savingUserId === row.user_id ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="graph-action-btn"
                        disabled={savingUserId === row.user_id}
                        onClick={() => void saveUser(row.user_id, true)}
                      >
                        Save + Reset password
                      </button>
                    </div>
                    {tempPasswords[row.user_id] ? (
                      <p style={{ marginTop: 8, marginBottom: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                        Temp password: <code>{tempPasswords[row.user_id]}</code>
                      </p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
