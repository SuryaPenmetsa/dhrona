import Link from 'next/link'

export default function AdminModulePage() {
  return (
    <main>
      <div className="admin-nav">
        <Link href="/">Home</Link>
        <Link href="/admin/wtr">WTR Upload</Link>
        <Link href="/admin/graph">Graph</Link>
        <Link href="/admin/access">Access</Link>
      </div>

      <h1>Admin module</h1>
      <p className="lead">
        Manage system-level operations: curriculum uploads, graph maintenance, and controlled user registration.
      </p>

      <section className="card">
        <h2 className="graph-section-title">User registration process</h2>
        <div className="wtr-process-list">
          <div className="wtr-process-item">
            <span>1</span> Open <Link href="/admin/access">Access control</Link> and add email invites.
          </div>
          <div className="wtr-process-item">
            <span>2</span> Invitees sign up from the Auth page using approved emails.
          </div>
          <div className="wtr-process-item">
            <span>3</span> After signup, review role and update to admin/member if needed.
          </div>
          <div className="wtr-process-item">
            <span>4</span> Remove pending invites once all family accounts are registered.
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="graph-section-title">Quick links</h2>
        <div className="wtr-menu-group">
          <Link href="/admin/access" className="wtr-menu-pill wtr-menu-pill-active">
            Access control
          </Link>
          <Link href="/admin/wtr" className="wtr-menu-pill">
            WTR upload
          </Link>
          <Link href="/admin/graph" className="wtr-menu-pill">
            Graph explorer
          </Link>
        </div>
      </section>
    </main>
  )
}
