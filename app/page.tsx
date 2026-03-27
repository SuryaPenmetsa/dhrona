import Link from 'next/link'

export default function HomePage() {
  return (
    <main>
      <h1>Drona</h1>
      <p className="lead">Knowledge graph tooling for tutoring.</p>
      <div className="admin-nav">
        <Link href="/admin/wtr">WTR / syllabus upload</Link>
        <Link href="/admin/graph">Graph explorer</Link>
      </div>
    </main>
  )
}
