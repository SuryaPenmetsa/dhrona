'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = {
  label: string
  href: string
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/' },
  { label: 'Study', href: '/tutor' },
  { label: 'Review', href: '/review' },
  { label: 'Parent', href: '/parent' },
  { label: 'Syllabus Upload', href: '/admin/wtr' },
  { label: 'Graph', href: '/admin/graph' },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/' || pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function GlobalNav() {
  const pathname = usePathname()

  return (
    <header className="global-nav-wrap">
      <div className="global-nav-inner">
        <Link href="/" className="global-nav-brand">
          Drona
        </Link>
        <nav className="global-nav-links" aria-label="Global">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`global-nav-link ${isActive(pathname, item.href) ? 'global-nav-link-active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
