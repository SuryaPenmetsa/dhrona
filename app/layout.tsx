import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Drona — knowledge graph',
  description: 'Admin tools for syllabus and curriculum maps',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
