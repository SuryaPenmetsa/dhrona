'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const adminItems = [
  { label: 'Overview', href: '/admin' },
  { label: 'WTR Upload', href: '/admin/wtr' },
  { label: 'Graph', href: '/admin/graph' },
  { label: 'Access', href: '/admin/access' },
  { label: 'Learning Profiles', href: '/admin/learning-profiles' },
  { label: 'LLM Settings', href: '/admin/llm-settings' },
]

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function AdminModuleNav() {
  const pathname = usePathname()

  return (
    <div className="admin-module-nav">
      <nav className="admin-module-tabs" aria-label="Admin module">
        {adminItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-module-tab ${isActive(pathname, item.href) ? 'admin-module-tab-active' : ''}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="admin-module-links">
        <Link href="/" className="admin-module-home-link">
          App Home
        </Link>
      </div>
    </div>
  )
}
