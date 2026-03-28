import { Suspense } from 'react'
import AuthForm from '@/components/auth/AuthForm'

export default function AuthPage() {
  return (
    <Suspense fallback={<main className="auth-page" />}>
      <AuthForm />
    </Suspense>
  )
}
