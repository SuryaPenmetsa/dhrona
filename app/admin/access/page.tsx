'use client'

import { useCallback, useEffect, useState } from 'react'
import AdminModuleNav from '@/components/navigation/AdminModuleNav'

type AppRole = 'admin' | 'member'

type UserRoleRow = {
  user_id: string
  email: string
  role: AppRole
  created_at: string
}

type InviteRow = {
  email: string
  role: AppRole
  note: string | null
  created_at: string
}

type AccessPayload = {
  currentUserId: string
  users: UserRoleRow[]
  invites: InviteRow[]
}

export default function AdminAccessPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<AccessPayload | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<AppRole>('member')
  const [inviteNote, setInviteNote] = useState('')
  const [savingInvite, setSavingInvite] = useState(false)

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
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not add invite.')
      setInviteEmail('')
      setInviteNote('')
      setInviteRole('member')
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

  async function updateRole(userId: string, role: AppRole) {
    try {
      const res = await fetch('/api/admin/access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not update role.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update role.')
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
        <form className="access-form-grid" onSubmit={addInvite}>
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
          <div className="access-form-action">
            <button className="primary" type="submit" disabled={savingInvite}>
              {savingInvite ? 'Saving...' : 'Add invite'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="graph-section-title">Pending invites</h2>
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
                <th>Note</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payload.invites.map(invite => (
                <tr key={invite.email}>
                  <td>{invite.email}</td>
                  <td>{invite.role}</td>
                  <td>{invite.note ?? '-'}</td>
                  <td>{new Date(invite.created_at).toLocaleString()}</td>
                  <td>
                    <button
                      type="button"
                      className="graph-action-btn graph-action-btn-danger"
                      onClick={() => void removeInvite(invite.email)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 className="graph-section-title">Registered users</h2>
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
                <th>Role</th>
                <th>Joined</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {payload.users.map(row => (
                <tr key={row.user_id}>
                  <td>
                    {row.email}
                    {row.user_id === payload.currentUserId ? ' (you)' : ''}
                  </td>
                  <td>{row.role}</td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>
                    <select
                      value={row.role}
                      onChange={event => void updateRole(row.user_id, event.target.value as AppRole)}
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
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
