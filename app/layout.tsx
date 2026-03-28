import type { Metadata } from 'next'
import GlobalNav from '@/components/navigation/GlobalNav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Drona — knowledge graph',
  description: 'Admin tools for syllabus and curriculum maps',
}

const themeInitScript = `
(() => {
  try {
    const stored = localStorage.getItem('drona-theme')
    const mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
    const resolveSystem = () =>
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    const resolved = mode === 'system' ? resolveSystem() : mode
    const root = document.documentElement
    root.setAttribute('data-theme', resolved)
    root.setAttribute('data-theme-mode', mode)
  } catch {
    // No-op if storage or media query is unavailable.
  }
})()
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <GlobalNav />
        {children}
      </body>
    </html>
  )
}
