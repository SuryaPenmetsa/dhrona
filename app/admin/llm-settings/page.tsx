'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminModuleNav from '@/components/navigation/AdminModuleNav'

type SettingsPayload = {
  settings: {
    tutorModelId: string
    profileGenerationModelId: string
    updatedAt: string | null
  }
  modelCatalog: Array<{
    id: string
    label: string
    provider: 'anthropic'
    inputUsdPerMillion: number
    outputUsdPerMillion: number
    contextWindowTokens: number
    recommendedFor: string
    estimatedCostUsdExamples: {
      light: number | null
      standard: number | null
      heavy: number | null
    }
  }>
  pricingDisclaimer: string
}

function formatUsd(value: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return `$${value.toFixed(4)}`
}

export default function AdminLlmSettingsPage() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<SettingsPayload | null>(null)

  const [tutorModelId, setTutorModelId] = useState('')
  const [profileGenerationModelId, setProfileGenerationModelId] = useState('')

  const hasUnsavedChanges = useMemo(() => {
    if (!payload) return false
    return (
      tutorModelId !== payload.settings.tutorModelId ||
      profileGenerationModelId !== payload.settings.profileGenerationModelId
    )
  }, [payload, profileGenerationModelId, tutorModelId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/llm-settings')
      const data = (await res.json()) as SettingsPayload & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load LLM settings')
      setPayload(data)
      setTutorModelId(data.settings.tutorModelId)
      setProfileGenerationModelId(data.settings.profileGenerationModelId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load LLM settings')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/llm-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tutorModelId,
          profileGenerationModelId,
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save LLM settings')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save LLM settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main>
      <AdminModuleNav />

      <h1>LLM model settings</h1>
      <p className="lead">
        Choose which model powers tutoring and profile generation. The pricing table helps compare cost impact.
      </p>

      {error ? (
        <section className="card">
          <p className="err" style={{ margin: 0 }}>
            {error}
          </p>
        </section>
      ) : null}

      <section className="card">
        <h2 className="graph-section-title">Model selection</h2>
        {loading || !payload ? (
          <p className="lead lp-lead-compact">Loading...</p>
        ) : (
          <form onSubmit={saveSettings} className="lp-stack">
            <div className="lp-field-grid">
              <div>
                <label htmlFor="tutor-model">Tutor chat model</label>
                <select id="tutor-model" value={tutorModelId} onChange={event => setTutorModelId(event.target.value)}>
                  {payload.modelCatalog.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="profile-generation-model">Profile generation model</label>
                <select
                  id="profile-generation-model"
                  value={profileGenerationModelId}
                  onChange={event => setProfileGenerationModelId(event.target.value)}
                >
                  {payload.modelCatalog.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="lp-action-row">
              <button className="primary" type="submit" disabled={saving || !hasUnsavedChanges}>
                {saving ? 'Saving...' : 'Save model settings'}
              </button>
              <button
                type="button"
                className="dash-reset-btn"
                disabled={saving || !hasUnsavedChanges}
                onClick={() => {
                  if (!payload) return
                  setTutorModelId(payload.settings.tutorModelId)
                  setProfileGenerationModelId(payload.settings.profileGenerationModelId)
                }}
              >
                Reset changes
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <h2 className="graph-section-title">Model pricing implications</h2>
        {loading || !payload ? (
          <p className="lead lp-lead-compact">Loading...</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Input $/1M tokens</th>
                  <th>Output $/1M tokens</th>
                  <th>Light (1k in, 0.5k out)</th>
                  <th>Standard (4k in, 1.2k out)</th>
                  <th>Heavy (12k in, 3k out)</th>
                  <th>Best for</th>
                </tr>
              </thead>
              <tbody>
                {payload.modelCatalog.map(model => (
                  <tr key={model.id}>
                    <td>{model.label}</td>
                    <td>{formatUsd(model.inputUsdPerMillion)}</td>
                    <td>{formatUsd(model.outputUsdPerMillion)}</td>
                    <td>{formatUsd(model.estimatedCostUsdExamples.light)}</td>
                    <td>{formatUsd(model.estimatedCostUsdExamples.standard)}</td>
                    <td>{formatUsd(model.estimatedCostUsdExamples.heavy)}</td>
                    <td>{model.recommendedFor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lead lp-lead-compact" style={{ marginTop: 10 }}>
              {payload.pricingDisclaimer}
            </p>
          </>
        )}
      </section>
    </main>
  )
}
