import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  extractWtrGraph,
  fetchExistingConceptsForPrompt,
  saveWtrGraphToDatabase,
} from '@/lib/graph/wtr'

export const runtime = 'nodejs'
export const maxDuration = 120

const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
])

const MAX_BYTES = 12 * 1024 * 1024

function checkAdmin(request: Request): boolean {
  const secret = process.env.WTR_ADMIN_SECRET
  if (!secret) return true
  return request.headers.get('x-admin-secret') === secret
}

export async function POST(request: Request) {
  try {
    return await postWtrProcess(request)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[wtr/process] fatal (non-JSON-safe path):', err)
    return NextResponse.json(
      {
        error: message,
        hint:
          'If this mentions Supabase env vars, set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local and restart the dev server.',
      },
      { status: 500 }
    )
  }
}

async function postWtrProcess(request: Request) {
  if (!checkAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      {
        error:
          'ANTHROPIC_API_KEY is not set. Add it to .env.local in the project root (see .env.example), then restart the dev server.',
      },
      { status: 500 }
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = form.get('file')
  if (
    !file ||
    typeof file !== 'object' ||
    !('arrayBuffer' in file) ||
    typeof file.arrayBuffer !== 'function' ||
    !('name' in file)
  ) {
    return NextResponse.json({ error: 'Missing file field "file"' }, { status: 400 })
  }

  const mimeType = ('type' in file && typeof file.type === 'string' && file.type) || 'application/octet-stream'
  if (!ALLOWED.has(mimeType)) {
    return NextResponse.json(
      { error: `Unsupported type ${mimeType}. Use PNG, JPEG, WebP, GIF, or PDF.` },
      { status: 400 }
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 12 MB)' }, { status: 400 })
  }

  const periodType = String(form.get('period_type') || 'weekly')
  const grade = form.get('grade') ? String(form.get('grade')) : null
  const label = form.get('label') ? String(form.get('label')) : null
  const schoolYear = form.get('school_year') ? String(form.get('school_year')) : null

  const periodLabel = [periodType, label, schoolYear].filter(Boolean).join(' · ')

  const supabase = createServiceClient()

  const { data: uploadRow, error: insertErr } = await supabase
    .from('wtr_uploads')
    .insert({
      filename: String(file.name),
      period_type: periodType,
      grade,
      label,
      school_year: schoolYear,
      mime_type: mimeType,
      file_size_bytes: buffer.length,
      status: 'processing',
    })
    .select('id')
    .single()

  if (insertErr || !uploadRow) {
    console.error('[wtr/process] insert upload:', insertErr)
    return NextResponse.json(
      { error: insertErr?.message ?? 'Could not create upload row. Is migration 003 applied?' },
      { status: 500 }
    )
  }

  const uploadId = uploadRow.id as string

  try {
    const existing = await fetchExistingConceptsForPrompt(supabase, { limit: 500 })
    const base64 = buffer.toString('base64')

    const extraction = await extractWtrGraph({
      fileBase64: base64,
      mimeType,
      grade,
      periodLabel,
      existingConcepts: existing,
    })

    const { conceptRows, connectionRows, errors: saveErrors } = await saveWtrGraphToDatabase({
      supabase,
      extraction,
      wtrUploadId: uploadId,
      grade,
    })

    const hasPartialFailure = saveErrors.length > 0
    const summary = {
      concepts: extraction.concepts.length,
      connections: extraction.connections.length,
      conceptRowsUpserted: conceptRows,
      connectionRowsInserted: connectionRows,
      ...(hasPartialFailure ? { saveErrors } : {}),
    }

    await supabase
      .from('wtr_uploads')
      .update({
        status: hasPartialFailure ? 'failed' : 'completed',
        completed_at: hasPartialFailure ? null : new Date().toISOString(),
        extraction_summary: summary,
        error_message: hasPartialFailure ? saveErrors.join('; ') : null,
      })
      .eq('id', uploadId)

    return NextResponse.json({
      ok: !hasPartialFailure,
      uploadId,
      extraction,
      summary,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from('wtr_uploads')
      .update({
        status: 'failed',
        error_message: message,
      })
      .eq('id', uploadId)

    console.error('[wtr/process]', err)
    return NextResponse.json({ error: message, uploadId }, { status: 500 })
  }
}

