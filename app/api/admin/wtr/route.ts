import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

function checkAdmin(request: Request): boolean {
  const secret = process.env.WTR_ADMIN_SECRET
  if (!secret) return true
  return request.headers.get('x-admin-secret') === secret
}

export async function GET(request: Request) {
  try {
    if (!checkAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
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
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
