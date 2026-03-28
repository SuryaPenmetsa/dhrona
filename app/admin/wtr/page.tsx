'use client'

import { useCallback, useEffect, useState } from 'react'
import AdminModuleNav from '@/components/navigation/AdminModuleNav'

type Period = 'weekly' | 'monthly' | 'term' | 'yearly' | 'other'

type UploadRow = {
  id: string
  filename: string
  period_type: string
  grade: string | null
  label: string | null
  school_year: string | null
  status: string
  extraction_summary: unknown
  created_at: string
  completed_at: string | null
  error_message: string | null
}

type UploadSummary = {
  concepts?: number
  connections?: number
  conceptRowsUpserted?: number
  connectionRowsInserted?: number
}

async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text.trim()) {
    throw new Error(
      `Empty response (HTTP ${res.status}). The server may have crashed, timed out, or hit a body-size limit. Check the terminal where "next dev" is running.`
    )
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(
      `Server did not return JSON (HTTP ${res.status}): ${text.slice(0, 500)}${text.length > 500 ? '…' : ''}`
    )
  }
}

export default function WtrAdminPage() {
  const [periodType, setPeriodType] = useState<Period>('weekly')
  const [grade, setGrade] = useState('Grade 6A')
  const [label, setLabel] = useState('')
  const [schoolYear, setSchoolYear] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<object | null>(null)
  const [uploads, setUploads] = useState<UploadRow[]>([])

  const latestUpload = uploads[0] ?? null
  const completedUploads = uploads.filter(upload => upload.status === 'completed').length
  const latestSummary = latestUpload ? getSummary(latestUpload) : null

  const loadUploads = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/wtr')
      const j = (await readJsonBody(res)) as { error?: string; uploads?: UploadRow[] }
      if (!res.ok) throw new Error(j.error || res.statusText)
      setUploads(j.uploads ?? [])
    } catch {
      /* ignore list errors on first paint */
    }
  }, [])

  useEffect(() => {
    void loadUploads()
  }, [loadUploads])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    if (!file) {
      setError('Choose a file (PNG, JPEG, PDF, …).')
      return
    }

    setLoading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('period_type', periodType)
      if (grade.trim()) body.append('grade', grade.trim())
      if (label.trim()) body.append('label', label.trim())
      if (schoolYear.trim()) body.append('school_year', schoolYear.trim())

      const res = await fetch('/api/admin/wtr/process', {
        method: 'POST',
        body,
      })
      const j = (await readJsonBody(res)) as {
        ok?: boolean
        error?: string
        hint?: string
        uploadId?: string
      }
      if (!res.ok) {
        const parts = [j.error, j.hint].filter(Boolean)
        throw new Error(parts.join(' ') || res.statusText)
      }
      setResult(j as object)
      void loadUploads()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function getSummary(upload: UploadRow): UploadSummary | null {
    if (!upload.extraction_summary || typeof upload.extraction_summary !== 'object') return null
    return upload.extraction_summary as UploadSummary
  }

  function formatWhen(value: string) {
    return new Date(value).toLocaleString()
  }

  function statusClass(status: string) {
    if (status === 'completed') return 'status-ok'
    if (status === 'failed') return 'status-err'
    if (status === 'processing') return 'status-warn'
    return 'status-muted'
  }

  return (
    <main>
      <AdminModuleNav />

      <div className="wtr-menu-bar">
        <div className="wtr-menu-group">
          <a href="#upload" className="wtr-menu-pill wtr-menu-pill-active">
            Upload
          </a>
          <a href="#recent-uploads" className="wtr-menu-pill">
            Recent uploads
          </a>
        </div>
      </div>

      <h1>WTR & syllabus map</h1>
      <p className="lead">
        Upload a weekly transaction report (image or PDF). Claude extracts concepts and relationships,
        merges with existing concepts in the database, and saves curriculum connections (
        <code>child_key = curriculum</code>).
      </p>

      <div className="wtr-stat-grid">
        <div className="card wtr-stat-card">
          <div className="wtr-stat-label">Uploads tracked</div>
          <div className="wtr-stat-value">{uploads.length}</div>
        </div>
        <div className="card wtr-stat-card">
          <div className="wtr-stat-label">Completed</div>
          <div className="wtr-stat-value">{completedUploads}</div>
        </div>
        <div className="card wtr-stat-card">
          <div className="wtr-stat-label">Latest file</div>
          <div className="wtr-stat-small">{latestUpload ? latestUpload.filename : 'No uploads yet'}</div>
        </div>
        <div className="card wtr-stat-card">
          <div className="wtr-stat-label">Latest graph output</div>
          <div className="wtr-stat-small">
            {latestSummary
              ? `${latestSummary.concepts ?? 0} concepts, ${latestSummary.connections ?? 0} links`
              : 'Upload a file to populate the graph'}
          </div>
        </div>
      </div>

      <div className="wtr-two-col" id="upload">
        <div className="card">
          <div className="wtr-card-header">
            <div>
              <h2 className="graph-section-title">Upload syllabus file</h2>
              <p className="lead wtr-sublead">
                Best results come from one file per week / month / term with a clear grade and label.
              </p>
            </div>
            <div className="wtr-header-chip-row">
              <span className="wtr-header-chip">PNG</span>
              <span className="wtr-header-chip">JPEG</span>
              <span className="wtr-header-chip">PDF</span>
            </div>
          </div>

          <form onSubmit={onSubmit}>
            <div className="wtr-form-grid">
              <div className="wtr-form-main">
                <label htmlFor="file">File</label>
                <label htmlFor="file" className="wtr-file-drop">
                  <span className="wtr-file-title">{file ? file.name : 'Choose PNG, JPEG, WebP, GIF, or PDF'}</span>
                  <span className="wtr-file-meta">
                    {file
                      ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                      : 'Upload one school WTR / syllabus document at a time'}
                  </span>
                </label>
                <input
                  id="file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />

                <div className="wtr-field-grid wtr-field-grid-3">
                  <div>
                    <label htmlFor="period">Period</label>
                    <select
                      id="period"
                      value={periodType}
                      onChange={e => setPeriodType(e.target.value as Period)}
                    >
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="term">Term</option>
                      <option value="yearly">Yearly</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="grade">Grade</label>
                    <input id="grade" value={grade} onChange={e => setGrade(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="sy">School year</label>
                    <input
                      id="sy"
                      placeholder="e.g. 2025-26"
                      value={schoolYear}
                      onChange={e => setSchoolYear(e.target.value)}
                    />
                  </div>
                </div>

                <div className="wtr-field-grid">
                  <div>
                    <label htmlFor="label">Label</label>
                    <input
                      id="label"
                      placeholder="e.g. week of 3 Mar"
                      value={label}
                      onChange={e => setLabel(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="wtr-form-side">
                <div className="wtr-help-box">
                  <div className="wtr-help-title">Before you upload</div>
                  <div className="wtr-help-line">
                    <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code>
                  </div>
                  <div className="wtr-help-line">
                    <code>NEXT_PUBLIC_SUPABASE_URL</code> and service role key set
                  </div>
                  <div className="wtr-help-line">Migration `003_wtr_curriculum.sql` applied</div>
                </div>

                <div className="wtr-help-box">
                  <div className="wtr-help-title">Tips for cleaner extraction</div>
                  <div className="wtr-help-line">Use one report per upload, not a merged packet.</div>
                  <div className="wtr-help-line">Include the grade and period so concepts are easier to organize.</div>
                  <div className="wtr-help-line">If a file looks noisy, upload a clearer PDF export when possible.</div>
                </div>
              </div>
            </div>

            <div className="wtr-actions">
              <button className="primary" type="submit" disabled={loading}>
                {loading ? 'Processing…' : 'Extract & save to graph'}
              </button>
              <span className="wtr-actions-note">
                Claude extracts concepts and links, then merges them into the existing graph.
              </span>
            </div>
          </form>

          {error && <p className="err" style={{ marginTop: '1rem' }}>{error}</p>}
        </div>

        <div className="wtr-side-stack">
          <div className="card">
            <h2 className="graph-section-title">What happens on upload</h2>
            <div className="wtr-process-list">
              <div className="wtr-process-item"><span>1</span> File is sent to Claude with existing concepts from Supabase.</div>
              <div className="wtr-process-item"><span>2</span> Concepts and relationships are extracted from the syllabus table.</div>
              <div className="wtr-process-item"><span>3</span> Concepts are merged by canonical name + subject.</div>
              <div className="wtr-process-item"><span>4</span> Curriculum links are saved and become visible in the graph explorer.</div>
            </div>
          </div>

          {latestUpload && (
            <div className="card">
              <h2 className="graph-section-title">Latest upload summary</h2>
              <div className="wtr-latest-grid">
                <div>
                  <div className="wtr-muted">File</div>
                  <div className="wtr-latest-value">{latestUpload.filename}</div>
                </div>
                <div>
                  <div className="wtr-muted">Status</div>
                  <div>
                    <span className={`wtr-status-badge ${statusClass(latestUpload.status)}`}>{latestUpload.status}</span>
                  </div>
                </div>
                <div>
                  <div className="wtr-muted">Created</div>
                  <div className="wtr-latest-value">{formatWhen(latestUpload.created_at)}</div>
                </div>
                <div>
                  <div className="wtr-muted">Graph output</div>
                  <div className="wtr-latest-value">
                    {latestSummary
                      ? `${latestSummary.concepts ?? 0} concepts, ${latestSummary.connections ?? 0} links`
                      : '-'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {result && (
            <div className="card">
              <h2 className="graph-section-title">Latest extraction</h2>
              <p className="ok" style={{ margin: '0 0 0.75rem' }}>
                Upload completed successfully.
              </p>
              <pre className="result">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>

      <div className="card" id="recent-uploads">
        <div className="wtr-card-header">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Recent uploads</h2>
          <span className="wtr-muted">{uploads.length} shown</span>
        </div>
        {uploads.length === 0 ? (
          <p className="lead" style={{ margin: 0 }}>
            No rows yet. Apply migration <code>003_wtr_curriculum.sql</code> and upload a file.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>File</th>
                <th>Grade</th>
                <th>Period</th>
                <th>Status</th>
                <th>Graph output</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map(u => (
                <tr key={u.id}>
                  <td>{formatWhen(u.created_at)}</td>
                  <td>
                    <div>{u.filename}</div>
                    {u.label ? <div className="wtr-table-sub">{u.label}</div> : null}
                  </td>
                  <td>{u.grade ?? '-'}</td>
                  <td>{u.period_type}</td>
                  <td>
                    <span className={`wtr-status-badge ${statusClass(u.status)}`}>{u.status}</span>
                  </td>
                  <td>
                    {getSummary(u) ? (
                      <div className="wtr-table-sub">
                        {getSummary(u)?.concepts ?? 0} concepts, {getSummary(u)?.connections ?? 0} links
                      </div>
                    ) : u.error_message ? (
                      <div className="wtr-table-sub err">{u.error_message}</div>
                    ) : (
                      <div className="wtr-table-sub">-</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
