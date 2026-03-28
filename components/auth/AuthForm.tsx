'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Mode = 'signin' | 'signup'

export default function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || '/'

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submitLabel = useMemo(() => (mode === 'signin' ? 'Sign in' : 'Create account'), [mode])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)

    try {
      const supabase = createClient()
      const trimmedEmail = email.trim().toLowerCase()
      if (!trimmedEmail) {
        throw new Error('Please enter an email address.')
      }
      if (!password) {
        throw new Error('Please enter a password.')
      }
      if (mode === 'signup' && password !== confirmPassword) {
        throw new Error('Passwords do not match.')
      }

      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        })
        if (signInError) throw signInError
        router.replace(nextPath)
        router.refresh()
        return
      }

      const statusRes = await fetch('/api/auth/registration-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      })
      const statusPayload = (await statusRes.json()) as {
        allowed?: boolean
        reason?: string
        error?: string
      }
      if (!statusRes.ok) {
        throw new Error(statusPayload.error ?? 'Could not verify registration access.')
      }
      if (!statusPayload.allowed) {
        if (statusPayload.reason === 'already_registered') {
          throw new Error('This email is already registered. Please sign in instead.')
        }
        throw new Error('Signup is invite-only. Ask an admin to approve this email first.')
      }

      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: { emailRedirectTo: redirectTo },
      })
      if (signUpError) throw signUpError

      if (data.session) {
        router.replace(nextPath)
        router.refresh()
        return
      }

      setMessage('Check your email to confirm your account, then sign in.')
      setMode('signin')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="card auth-card">
        <h1>{mode === 'signin' ? 'Sign in to Drona' : 'Create your Drona account'}</h1>
        <p className="lead auth-lead">
          Use Supabase email/password authentication. New registrations are invite-only.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div>
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
              minLength={6}
            />
          </div>

          {mode === 'signup' ? (
            <div>
              <label htmlFor="auth-confirm-password">Confirm password</label>
              <input
                id="auth-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                required
                minLength={6}
              />
            </div>
          ) : null}

          <button type="submit" className="primary" disabled={loading}>
            {loading ? 'Working...' : submitLabel}
          </button>
        </form>

        {error ? <p className="err auth-note">{error}</p> : null}
        {message ? <p className="ok auth-note">{message}</p> : null}

        <div className="auth-mode-toggle">
          {mode === 'signin' ? (
            <p>
              New user?{' '}
              <button
                type="button"
                className="auth-inline-btn"
                onClick={() => {
                  setMode('signup')
                  setError(null)
                  setMessage(null)
                }}
              >
                Create account
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{' '}
              <button
                type="button"
                className="auth-inline-btn"
                onClick={() => {
                  setMode('signin')
                  setError(null)
                  setMessage(null)
                }}
              >
                Sign in
              </button>
            </p>
          )}
        </div>
      </section>
    </main>
  )
}
