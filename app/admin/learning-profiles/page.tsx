'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminModuleNav from '@/components/navigation/AdminModuleNav'

type LearningProfile = {
  id: string
  name: string
  personality_summary: string | null
  llm_instructions_rich_text: string
  suggestion_question_instructions_rich_text: string
  created_at: string
  updated_at: string
}

type KidUser = {
  user_id: string
  email: string
  role: 'admin' | 'member'
}

type Assignment = {
  user_id: string
  learning_profile_id: string
  assigned_at: string
}

type PendingInvite = {
  email: string
  role: 'admin' | 'member'
  first_name: string | null
  last_name: string | null
  learning_profile_id: string | null
}

type Payload = {
  profiles: LearningProfile[]
  users: KidUser[]
  assignments: Assignment[]
  pendingInvites: PendingInvite[]
}

const EMPTY_CREATE = {
  name: '',
  personalitySummary: '',
  llmInstructionsRichText: '',
  suggestionQuestionInstructionsRichText: '',
}

const EMPTY_GENERATOR = {
  childName: '',
  personalitySummary: '',
  learningGoals: '',
  constraints: '',
}

export default function LearningProfilesAdminPage() {
  const [activeTab, setActiveTab] = useState<'generate' | 'profiles' | 'assignments'>('generate')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<Payload | null>(null)

  const [createForm, setCreateForm] = useState(EMPTY_CREATE)
  const [generatorForm, setGeneratorForm] = useState(EMPTY_GENERATOR)
  const [generatedInstructions, setGeneratedInstructions] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const selectedProfile = useMemo(
    () => payload?.profiles.find(profile => profile.id === editingId) ?? null,
    [editingId, payload?.profiles]
  )

  const assignmentsByUser = useMemo(() => {
    const byUser: Record<string, string> = {}
    for (const item of payload?.assignments ?? []) {
      byUser[item.user_id] = item.learning_profile_id
    }
    return byUser
  }, [payload?.assignments])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/learning-profiles')
      const data = (await res.json()) as Payload & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load learning profiles')
      setPayload(data)
      if (!editingId && data.profiles.length > 0) {
        setEditingId(data.profiles[0].id)
      } else if (editingId && !data.profiles.some(item => item.id === editingId)) {
        setEditingId(data.profiles[0]?.id ?? null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load learning profiles')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [editingId])

  useEffect(() => {
    void load()
  }, [load])

  async function createProfile(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/learning-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      const data = (await res.json()) as { error?: string; id?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to create profile')
      setCreateForm(EMPTY_CREATE)
      await load()
      if (data.id) {
        setEditingId(data.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile')
    } finally {
      setSaving(false)
    }
  }

  async function updateProfile(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedProfile) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/learning-profiles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateProfile',
          profileId: selectedProfile.id,
          name: selectedProfile.name,
          personalitySummary: selectedProfile.personality_summary,
          llmInstructionsRichText: selectedProfile.llm_instructions_rich_text,
          suggestionQuestionInstructionsRichText: selectedProfile.suggestion_question_instructions_rich_text,
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to update profile')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  async function assignProfile(targetUserId: string, profileId: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/learning-profiles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assignProfile',
          targetUserId,
          profileId: profileId || null,
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to assign profile')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign profile')
    } finally {
      setSaving(false)
    }
  }

  async function assignInviteProfile(inviteEmail: string, profileId: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/learning-profiles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assignProfile',
          inviteEmail,
          profileId: profileId || null,
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to assign invite profile')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign invite profile')
    } finally {
      setSaving(false)
    }
  }

  async function deleteSelectedProfile() {
    if (!selectedProfile) return
    const confirmed = window.confirm(`Delete profile "${selectedProfile.name}"?`)
    if (!confirmed) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/learning-profiles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: selectedProfile.id }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete profile')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete profile')
    } finally {
      setSaving(false)
    }
  }

  async function generateInstructionsWithClaude() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/learning-profiles/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generatorForm),
      })
      const data = (await res.json()) as { error?: string; instructions?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate instructions')
      const generated = data.instructions ?? ''
      setGeneratedInstructions(generated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate instructions')
    } finally {
      setSaving(false)
    }
  }

  function updateSelectedProfile(
    field:
      | 'name'
      | 'personality_summary'
      | 'llm_instructions_rich_text'
      | 'suggestion_question_instructions_rich_text',
    value: string
  ) {
    if (!selectedProfile) return
    setPayload(prev =>
      prev
        ? {
            ...prev,
            profiles: prev.profiles.map(profile => {
              if (profile.id !== selectedProfile.id) return profile
              if (field === 'personality_summary') {
                return { ...profile, personality_summary: value || null }
              }
              return { ...profile, [field]: value }
            }),
          }
        : prev
    )
  }

  function applyGeneratedToCreateForm() {
    if (!generatedInstructions.trim()) return
    setCreateForm(prev => ({
      ...prev,
      personalitySummary: generatorForm.personalitySummary,
      llmInstructionsRichText: generatedInstructions,
    }))
    setActiveTab('profiles')
  }

  function applyGeneratedToSelectedProfile() {
    if (!selectedProfile || !generatedInstructions.trim()) return
    updateSelectedProfile('llm_instructions_rich_text', generatedInstructions)
    if (generatorForm.personalitySummary.trim()) {
      updateSelectedProfile('personality_summary', generatorForm.personalitySummary)
    }
    setActiveTab('profiles')
  }

  const hasProfiles = (payload?.profiles.length ?? 0) > 0
  const hasRegisteredKids = (payload?.users.length ?? 0) > 0
  const hasPendingKids = (payload?.pendingInvites.length ?? 0) > 0
  const hasKids = hasRegisteredKids || hasPendingKids

  return (
    <main>
      <AdminModuleNav />

      <h1>Learning profiles</h1>
      <p className="lead">
        Manage this in 3 clear steps: generate instructions, save profiles, then assign each kid to one profile.
      </p>

      {error ? (
        <section className="card">
          <p className="err" style={{ margin: 0 }}>
            {error}
          </p>
        </section>
      ) : null}

      <section className="card lp-tabs-card">
        <div className="lp-tabs">
          <button
            type="button"
            className={`wtr-menu-pill ${activeTab === 'generate' ? 'wtr-menu-pill-active' : ''}`}
            onClick={() => setActiveTab('generate')}
          >
            1. Generate
          </button>
          <button
            type="button"
            className={`wtr-menu-pill ${activeTab === 'profiles' ? 'wtr-menu-pill-active' : ''}`}
            onClick={() => setActiveTab('profiles')}
          >
            2. Profiles
          </button>
          <button
            type="button"
            className={`wtr-menu-pill ${activeTab === 'assignments' ? 'wtr-menu-pill-active' : ''}`}
            onClick={() => setActiveTab('assignments')}
          >
            3. Assignments
          </button>
        </div>
      </section>

      {activeTab === 'generate' ? (
        <section className="card">
          <h2 className="graph-section-title">Generate instruction draft</h2>
          <p className="lead lp-lead-compact">
            Describe the kid once, generate a draft, then send it to a profile in the next tab.
          </p>

          <div className="lp-two-col">
            <div>
              <div className="lp-field-grid">
                <div>
                  <label htmlFor="gen-child-name">Kid name (optional)</label>
                  <input
                    id="gen-child-name"
                    value={generatorForm.childName}
                    onChange={event => setGeneratorForm(prev => ({ ...prev, childName: event.target.value }))}
                    placeholder="Aarav"
                  />
                </div>
                <div>
                  <label htmlFor="gen-goals">Learning goals</label>
                  <input
                    id="gen-goals"
                    value={generatorForm.learningGoals}
                    onChange={event => setGeneratorForm(prev => ({ ...prev, learningGoals: event.target.value }))}
                    placeholder="Confidence in algebra, better word-problem reasoning"
                  />
                </div>
              </div>

              <div className="lp-form-row">
                <label htmlFor="gen-personality">Personality summary</label>
                <textarea
                  id="gen-personality"
                  rows={5}
                  value={generatorForm.personalitySummary}
                  onChange={event => setGeneratorForm(prev => ({ ...prev, personalitySummary: event.target.value }))}
                  placeholder="Curious but anxious about mistakes. Engages better with examples and positive feedback."
                />
              </div>

              <div className="lp-form-row">
                <label htmlFor="gen-constraints">Tutor constraints</label>
                <textarea
                  id="gen-constraints"
                  rows={4}
                  value={generatorForm.constraints}
                  onChange={event => setGeneratorForm(prev => ({ ...prev, constraints: event.target.value }))}
                  placeholder="Avoid pressure language, keep steps short, include quick confidence checks."
                />
              </div>

              <button
                type="button"
                className="primary"
                disabled={saving || !generatorForm.personalitySummary.trim()}
                onClick={() => void generateInstructionsWithClaude()}
              >
                {saving ? 'Generating...' : 'Generate draft'}
              </button>
            </div>

            <div>
              <label htmlFor="gen-result">Generated rich-text instructions (markdown)</label>
              <textarea
                id="gen-result"
                rows={17}
                value={generatedInstructions}
                onChange={event => setGeneratedInstructions(event.target.value)}
                placeholder="Generated instructions will appear here..."
              />

              <div className="lp-action-row">
                <button
                  type="button"
                  className="dash-reset-btn"
                  disabled={!generatedInstructions.trim()}
                  onClick={applyGeneratedToCreateForm}
                >
                  Send to new profile form
                </button>
                <button
                  type="button"
                  className="dash-reset-btn"
                  disabled={!generatedInstructions.trim() || !selectedProfile}
                  onClick={applyGeneratedToSelectedProfile}
                >
                  Apply to selected profile
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'profiles' ? (
        <>
          <section className="card">
            <h2 className="graph-section-title">Create profile</h2>
            <form onSubmit={createProfile} className="lp-stack">
              <div className="lp-field-grid">
                <div>
                  <label htmlFor="create-name">Profile name</label>
                  <input
                    id="create-name"
                    value={createForm.name}
                    onChange={event => setCreateForm(prev => ({ ...prev, name: event.target.value }))}
                    placeholder="Focus Coach"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="create-personality">Personality summary</label>
                  <input
                    id="create-personality"
                    value={createForm.personalitySummary}
                    onChange={event => setCreateForm(prev => ({ ...prev, personalitySummary: event.target.value }))}
                    placeholder="Optional quick summary"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="create-instructions">LLM instructions (rich text / markdown)</label>
                <textarea
                  id="create-instructions"
                  rows={10}
                  value={createForm.llmInstructionsRichText}
                  onChange={event =>
                    setCreateForm(prev => ({ ...prev, llmInstructionsRichText: event.target.value }))
                  }
                  placeholder="Paste or edit generated instructions here..."
                  required
                />
              </div>
              <div>
                <label htmlFor="create-suggestion-instructions">Suggestion question instructions (optional)</label>
                <textarea
                  id="create-suggestion-instructions"
                  rows={8}
                  value={createForm.suggestionQuestionInstructionsRichText}
                  onChange={event =>
                    setCreateForm(prev => ({
                      ...prev,
                      suggestionQuestionInstructionsRichText: event.target.value,
                    }))
                  }
                  placeholder="Optional guidance for follow-up suggested questions (tone, format, difficulty progression)."
                />
              </div>

              <button className="primary" type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Create profile'}
              </button>
            </form>
          </section>

          <section className="card">
            <h2 className="graph-section-title">Edit existing profile</h2>
            {loading ? (
              <p className="lead lp-lead-compact">Loading...</p>
            ) : !hasProfiles ? (
              <p className="lead lp-lead-compact">No profiles yet.</p>
            ) : (
              <div className="lp-two-col">
                <div>
                  <div className="lp-profile-list">
                    {(payload?.profiles ?? []).map(profile => (
                      <button
                        key={profile.id}
                        type="button"
                        className={`lp-profile-item ${editingId === profile.id ? 'lp-profile-item-active' : ''}`}
                        onClick={() => setEditingId(profile.id)}
                      >
                        <strong>{profile.name}</strong>
                        <span>{profile.personality_summary ?? 'No summary'}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  {selectedProfile ? (
                    <form onSubmit={updateProfile} className="lp-stack">
                      <div className="lp-field-grid">
                        <div>
                          <label htmlFor="edit-name">Profile name</label>
                          <input
                            id="edit-name"
                            value={selectedProfile.name}
                            onChange={event => updateSelectedProfile('name', event.target.value)}
                            required
                          />
                        </div>
                        <div>
                          <label htmlFor="edit-personality">Personality summary</label>
                          <input
                            id="edit-personality"
                            value={selectedProfile.personality_summary ?? ''}
                            onChange={event => updateSelectedProfile('personality_summary', event.target.value)}
                          />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="edit-instructions">LLM instructions</label>
                        <textarea
                          id="edit-instructions"
                          rows={14}
                          value={selectedProfile.llm_instructions_rich_text}
                          onChange={event =>
                            updateSelectedProfile('llm_instructions_rich_text', event.target.value)
                          }
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="edit-suggestion-instructions">Suggestion question instructions</label>
                        <textarea
                          id="edit-suggestion-instructions"
                          rows={8}
                          value={selectedProfile.suggestion_question_instructions_rich_text}
                          onChange={event =>
                            updateSelectedProfile('suggestion_question_instructions_rich_text', event.target.value)
                          }
                          placeholder="Optional guidance for follow-up suggested questions."
                        />
                      </div>
                      <div className="lp-action-row">
                        <button className="primary" type="submit" disabled={saving}>
                          {saving ? 'Saving...' : 'Save changes'}
                        </button>
                        <button
                          type="button"
                          className="graph-action-btn graph-action-btn-danger"
                          disabled={saving}
                          onClick={() => void deleteSelectedProfile()}
                        >
                          Delete profile
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="lead lp-lead-compact">Select a profile to edit.</p>
                  )}
                </div>
              </div>
            )}
          </section>
        </>
      ) : null}

      {activeTab === 'assignments' ? (
        <section className="card">
          <h2 className="graph-section-title">Assign profiles to kids</h2>
          <p className="lead lp-lead-compact">
            Pick one profile per kid account. Changes are saved immediately.
          </p>

          {loading ? (
            <p className="lead lp-lead-compact">Loading...</p>
          ) : !hasKids ? (
            <p className="lead lp-lead-compact">No kid users found.</p>
          ) : !hasProfiles ? (
            <p className="lead lp-lead-compact">Create at least one profile first.</p>
          ) : (
            <>
              {hasPendingKids ? (
                <section style={{ marginBottom: 14 }}>
                  <h3 className="graph-section-title" style={{ marginTop: 0 }}>
                    Pending kids (before signup)
                  </h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Invite email</th>
                        <th>Name</th>
                        <th>Assigned profile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payload?.pendingInvites ?? []).map(invite => (
                        <tr key={invite.email}>
                          <td>{invite.email}</td>
                          <td>{[invite.first_name, invite.last_name].filter(Boolean).join(' ') || '-'}</td>
                          <td>
                            <select
                              value={invite.learning_profile_id ?? ''}
                              onChange={event => void assignInviteProfile(invite.email, event.target.value)}
                              disabled={saving}
                            >
                              <option value="">No profile</option>
                              {(payload?.profiles ?? []).map(profile => (
                                <option key={profile.id} value={profile.id}>
                                  {profile.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}

              {hasRegisteredKids ? (
                <section>
                  <h3 className="graph-section-title" style={{ marginTop: 0 }}>
                    Registered kids
                  </h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Kid account</th>
                        <th>Assigned profile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payload?.users ?? []).map(user => (
                        <tr key={user.user_id}>
                          <td>{user.email}</td>
                          <td>
                            <select
                              value={assignmentsByUser[user.user_id] ?? ''}
                              onChange={event => void assignProfile(user.user_id, event.target.value)}
                              disabled={saving}
                            >
                              <option value="">No profile</option>
                              {(payload?.profiles ?? []).map(profile => (
                                <option key={profile.id} value={profile.id}>
                                  {profile.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </main>
  )
}
