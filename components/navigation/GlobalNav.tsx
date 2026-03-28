'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

type NavItem = {
  label: string
  href: string
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/' },
  { label: 'Study', href: '/tutor' },
  { label: 'Review', href: '/review' },
  { label: 'Parent', href: '/parent' },
  { label: 'Admin', href: '/admin', adminOnly: true },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/' || pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function GlobalNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [userRole, setUserRole] = useState<'admin' | 'member' | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  async function loadRole(userId: string) {
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
    const role = data?.role === 'admin' ? 'admin' : 'member'
    setUserRole(role)
  }

  useEffect(() => {
    let mounted = true

    async function loadSession() {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()
      if (!mounted) return
      setUser(currentUser)
      if (currentUser) {
        await loadRole(currentUser.id)
      } else {
        setUserRole(null)
      }
      setAuthLoading(false)
    }

    void loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      if (nextUser) {
        void loadRole(nextUser.id)
      } else {
        setUserRole(null)
      }
      setAuthLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  async function handleSignOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    setUser(null)
    setUserRole(null)
    setSigningOut(false)
    router.replace('/auth')
    router.refresh()
  }

  return (
    <header className="global-nav-wrap">
      <div className="global-nav-inner">
        <Link href="/" className="global-nav-brand">
          Drona
        </Link>
        <nav className="global-nav-links" aria-label="Global">
          {user
            ? navItems
                .filter(item => !item.adminOnly || userRole === 'admin')
                .map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`global-nav-link ${isActive(pathname, item.href) ? 'global-nav-link-active' : ''}`}
                  >
                    {item.label}
                  </Link>
                ))
            : null}
        </nav>

        <div className="global-nav-auth">
          {authLoading ? (
            <span className="global-nav-user">Checking session...</span>
          ) : user ? (
            <>
              <span className="global-nav-user">{user.email}</span>
              <button type="button" className="global-nav-signout" onClick={handleSignOut} disabled={signingOut}>
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
            </>
          ) : (
            <Link
              href="/auth"
              className={`global-nav-link ${isActive(pathname, '/auth') ? 'global-nav-link-active' : ''}`}
            >
              Auth
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
