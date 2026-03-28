import { NextResponse } from 'next/server'
import { AuthzError, requireAdmin } from '@/lib/auth/admin'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const { service } = await requireAdmin()
    const { data, error } = await service
      .from('wtr_uploads')
      .select(
        'id, filename, period_type, grade, label, school_year, status, extraction_summary, created_at, completed_at, error_message'
      )
      .order('created_at', { ascending: false })
      .limit(40)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ uploads: data ?? [] })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
