'use client'

import { FormEvent, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
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
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })
      if (signInError) throw signInError
      router.replace(nextPath)
      router.refresh()
      return
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="card auth-card">
        <h1>Sign in to Drona</h1>
        <p className="lead auth-lead">
          Use your approved account credentials. Registration is managed by admin only.
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
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
              minLength={6}
            />
          </div>

          <button type="submit" className="primary" disabled={loading}>
            {loading ? 'Working...' : 'Sign in'}
          </button>
        </form>

        {error ? <p className="err auth-note">{error}</p> : null}
      </section>
    </main>
  )
}
