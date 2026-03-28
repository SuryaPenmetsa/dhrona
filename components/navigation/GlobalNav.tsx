'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

type NavItem = {
  label: string
  href: string
  adminOnly?: boolean
}

type ThemeMode = 'light' | 'dark' | 'system'

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/' },
  { label: 'Study', href: '/tutor' },
  { label: 'Review', href: '/review' },
  { label: 'Parent', href: '/parent' },
  { label: 'Admin', href: '/admin', adminOnly: true },
]

const THEME_STORAGE_KEY = 'drona-theme'

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/' || pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function resolveSystemTheme() {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return
  const resolved = mode === 'system' ? resolveSystemTheme() : mode
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  root.setAttribute('data-theme-mode', mode)
}

export default function GlobalNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [userRole, setUserRole] = useState<'admin' | 'member' | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [authLoading, setAuthLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const supabase = useMemo(() => createClient(), [])

  async function loadUserContext(userId: string) {
    const [{ data: roleData }, { data: profileData }] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
      supabase.from('user_profiles').select('first_name, last_name').eq('user_id', userId).maybeSingle(),
    ])

    setUserRole(roleData?.role === 'admin' ? 'admin' : 'member')
    const fullName = [profileData?.first_name?.trim(), profileData?.last_name?.trim()].filter(Boolean).join(' ')
    setUserName(fullName || null)
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
        await loadUserContext(currentUser.id)
      } else {
        setUserRole(null)
        setUserName(null)
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
        void loadUserContext(nextUser.id)
      } else {
        setUserRole(null)
        setUserName(null)
      }
      setAuthLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!menuRef.current) return
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    const initialMode: ThemeMode =
      stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
    setThemeMode(initialMode)
    applyTheme(initialMode)
  }, [])

  useEffect(() => {
    applyTheme(themeMode)
    localStorage.setItem(THEME_STORAGE_KEY, themeMode)
    if (themeMode !== 'system') {
      return
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => applyTheme('system')
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [themeMode])

  async function handleSignOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    setUser(null)
    setUserRole(null)
    setUserName(null)
    setMenuOpen(false)
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
            <div className="global-nav-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="global-nav-menu-trigger"
                onClick={() => setMenuOpen(prev => !prev)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="global-nav-menu-name">{userName ?? user.email ?? 'Account'}</span>
                <span className="global-nav-menu-caret">▾</span>
              </button>
              {menuOpen ? (
                <div className="global-nav-menu" role="menu">
                  <div className="global-nav-menu-email">{user.email}</div>
                  <div className="global-nav-menu-section-title">Theme</div>
                  <div className="global-nav-theme-options" role="group" aria-label="Theme mode">
                    <button
                      type="button"
                      className={`global-nav-theme-option ${themeMode === 'light' ? 'global-nav-theme-option-active' : ''}`}
                      onClick={() => setThemeMode('light')}
                      role="menuitemradio"
                      aria-checked={themeMode === 'light'}
                    >
                      Light
                    </button>
                    <button
                      type="button"
                      className={`global-nav-theme-option ${themeMode === 'dark' ? 'global-nav-theme-option-active' : ''}`}
                      onClick={() => setThemeMode('dark')}
                      role="menuitemradio"
                      aria-checked={themeMode === 'dark'}
                    >
                      Dark
                    </button>
                    <button
                      type="button"
                      className={`global-nav-theme-option ${themeMode === 'system' ? 'global-nav-theme-option-active' : ''}`}
                      onClick={() => setThemeMode('system')}
                      role="menuitemradio"
                      aria-checked={themeMode === 'system'}
                    >
                      System
                    </button>
                  </div>
                  <button
                    type="button"
                    className="global-nav-menu-item"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    role="menuitem"
                  >
                    {signingOut ? 'Signing out...' : 'Sign out'}
                  </button>
                </div>
              ) : null}
            </div>
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
