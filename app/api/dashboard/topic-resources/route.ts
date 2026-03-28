import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const TOPIC_RESOURCE_BUCKET = 'topic-resources'

type TopicResourceRow = {
  id: string
  topic_title: string
  topic_subject: string | null
  resource_type: 'file' | 'url' | 'note'
  label: string | null
  url: string | null
  file_name: string | null
  storage_bucket: string | null
  storage_path: string | null
  note_content: string | null
  created_by: string
  created_at: string
}

type TopicResourceShareRow = {
  resource_id: string
}

function normalizeNullableText(value: string | null | undefined) {
  const next = value?.trim()
  return next ? next : null
}

function normalizeFileName(name: string) {
  const idx = name.lastIndexOf('.')
  const base = idx > 0 ? name.slice(0, idx) : name
  const ext = idx > 0 ? name.slice(idx) : ''
  const safeBase = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12)
  return `${safeBase || 'file'}${safeExt}`
}

function topicSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
}

async function requireUserId() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    throw new Error('Authentication required')
  }
  return user.id
}

function sameNullableText(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? '') === (b ?? '')
}

function isFileLike(value: unknown): value is { size: number; type?: string; name?: string; arrayBuffer: () => Promise<ArrayBuffer> } {
  if (!value || typeof value !== 'object') return false
  const maybe = value as {
    size?: unknown
    type?: unknown
    name?: unknown
    arrayBuffer?: unknown
  }
  return typeof maybe.size === 'number' && typeof maybe.arrayBuffer === 'function'
}

async function withSignedUrl(row: TopicResourceRow, service = createServiceClient()) {
  if (row.resource_type === 'url' || row.resource_type === 'note') {
    return { ...row, open_url: row.url }
  }
  if (!row.storage_path) {
    return { ...row, open_url: null }
  }
  const bucket = row.storage_bucket || TOPIC_RESOURCE_BUCKET
  const { data } = await service.storage.from(bucket).createSignedUrl(row.storage_path, 60 * 60)
  return { ...row, open_url: data?.signedUrl ?? null }
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId()
    const { searchParams } = new URL(request.url)
    const topicTitle = searchParams.get('topic_title')?.trim()
    const topicSubject = normalizeNullableText(searchParams.get('topic_subject'))
    if (!topicTitle) {
      return NextResponse.json({ error: 'Missing topic_title' }, { status: 400 })
    }

    const service = createServiceClient()

    const { data: ownData, error: ownError } = await service
      .from('topic_resources')
      .select(
        'id, topic_title, topic_subject, resource_type, label, url, file_name, storage_bucket, storage_path, note_content, created_by, created_at'
      )
      .eq('created_by', userId)
      .eq('topic_title', topicTitle)
      .order('created_at', { ascending: false })
    if (ownError) throw new Error(ownError.message)

    const { data: sharedRows, error: sharedError } = await service
      .from('topic_resource_shares')
      .select('resource_id')
      .eq('shared_with_user_id', userId)
    if (sharedError) throw new Error(sharedError.message)

    const sharedResourceIds = (sharedRows ?? []).map(row => (row as TopicResourceShareRow).resource_id)

    let sharedResources: TopicResourceRow[] = []
    if (sharedResourceIds.length > 0) {
      const { data: sharedData, error: sharedDataError } = await service
        .from('topic_resources')
        .select(
          'id, topic_title, topic_subject, resource_type, label, url, file_name, storage_bucket, storage_path, note_content, created_by, created_at'
        )
        .in('id', sharedResourceIds)
        .eq('topic_title', topicTitle)
        .order('created_at', { ascending: false })
      if (sharedDataError) throw new Error(sharedDataError.message)
      sharedResources = (sharedData ?? []) as TopicResourceRow[]
    }

    const ownRows = ((ownData ?? []) as TopicResourceRow[]).filter(row =>
      sameNullableText(row.topic_subject, topicSubject)
    )
    const sharedFiltered = sharedResources.filter(row => sameNullableText(row.topic_subject, topicSubject))
    const mergedMap = new Map<string, TopicResourceRow>()
    for (const row of ownRows) {
      mergedMap.set(row.id, row)
    }
    for (const row of sharedFiltered) {
      if (!mergedMap.has(row.id)) {
        mergedMap.set(row.id, row)
      }
    }
    const rows = Array.from(mergedMap.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))

    const resources = await Promise.all(
      rows.map(async row => {
        const base = await withSignedUrl(row, service)
        return {
          ...base,
          visibility: row.created_by === userId ? 'own' : 'shared',
        }
      })
    )
    return NextResponse.json({ resources })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message === 'Authentication required' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const service = createServiceClient()
    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const topicTitle = String(form.get('topic_title') ?? '').trim()
      const topicSubject = normalizeNullableText(String(form.get('topic_subject') ?? ''))
      const label = normalizeNullableText(String(form.get('label') ?? ''))
      const fileValue = form.get('file')

      if (!topicTitle) {
        return NextResponse.json({ error: 'Missing topic_title' }, { status: 400 })
      }
      if (!isFileLike(fileValue)) {
        return NextResponse.json({ error: 'Missing file' }, { status: 400 })
      }
      const file = fileValue
      if (file.size <= 0) {
        return NextResponse.json({ error: 'Cannot upload an empty file.' }, { status: 400 })
      }

      const safeName = normalizeFileName(file.name || 'file')
      const subjectSlug = topicSlug(topicSubject || 'general')
      const topicPath = topicSlug(topicTitle)
      const storagePath = `${subjectSlug}/${topicPath}/${Date.now()}-${safeName}`
      const bytes = Buffer.from(await file.arrayBuffer())

      const { error: uploadError } = await service.storage
        .from(TOPIC_RESOURCE_BUCKET)
        .upload(storagePath, bytes, {
          upsert: false,
          contentType: file.type || 'application/octet-stream',
        })
      if (uploadError) throw new Error(uploadError.message)

      const { data: inserted, error: insertError } = await service
        .from('topic_resources')
        .insert({
          topic_title: topicTitle,
          topic_subject: topicSubject,
          resource_type: 'file',
          label,
          file_name: file.name || safeName,
          storage_bucket: TOPIC_RESOURCE_BUCKET,
          storage_path: storagePath,
          note_content: null,
          created_by: userId,
        })
        .select(
          'id, topic_title, topic_subject, resource_type, label, url, file_name, storage_bucket, storage_path, note_content, created_by, created_at'
        )
        .single()
      if (insertError) throw new Error(insertError.message)

      return NextResponse.json({ resource: await withSignedUrl(inserted as TopicResourceRow, service) })
    }

    const body = (await request.json()) as {
      topicTitle?: string
      topicSubject?: string | null
      label?: string
      url?: string
      noteContent?: string
    }
    const topicTitle = body.topicTitle?.trim()
    const topicSubject = normalizeNullableText(body.topicSubject)
    const label = normalizeNullableText(body.label)
    const rawUrl = body.url?.trim()
    const noteContent = body.noteContent?.trim()

    if (!topicTitle) {
      return NextResponse.json({ error: 'Missing topicTitle' }, { status: 400 })
    }
    if (!rawUrl && !noteContent) {
      return NextResponse.json({ error: 'Provide either url or noteContent' }, { status: 400 })
    }

    let parsedUrl: URL | null = null
    if (rawUrl) {
      try {
        parsedUrl = new URL(rawUrl)
      } catch {
        return NextResponse.json({ error: 'Provide a valid URL.' }, { status: 400 })
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return NextResponse.json({ error: 'Only http/https URLs are allowed.' }, { status: 400 })
      }
    }

    const resourceType: TopicResourceRow['resource_type'] = parsedUrl ? 'url' : 'note'
    const { data: inserted, error: insertError } = await service
      .from('topic_resources')
      .insert({
        topic_title: topicTitle,
        topic_subject: topicSubject,
        resource_type: resourceType,
        label,
        url: parsedUrl ? parsedUrl.toString() : null,
        note_content: noteContent || null,
        created_by: userId,
      })
      .select(
        'id, topic_title, topic_subject, resource_type, label, url, file_name, storage_bucket, storage_path, note_content, created_by, created_at'
      )
      .single()
    if (insertError) throw new Error(insertError.message)

    const insertedRow = inserted as TopicResourceRow
    return NextResponse.json({
      resource: {
        ...insertedRow,
        open_url: insertedRow.resource_type === 'url' ? insertedRow.url : null,
        visibility: 'own',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message === 'Authentication required' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId()
    const service = createServiceClient()
    const body = (await request.json()) as { id?: string }
    const id = body.id?.trim()
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const { data: row, error: rowError } = await service
      .from('topic_resources')
      .select(
        'id, topic_title, topic_subject, resource_type, label, url, file_name, storage_bucket, storage_path, note_content, created_by, created_at'
      )
      .eq('id', id)
      .maybeSingle()
    if (rowError) throw new Error(rowError.message)
    if (!row) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
    }

    const { data: roleRow } = await service.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
    const isAdmin = roleRow?.role === 'admin'
    if (row.created_by !== userId && !isAdmin) {
      return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }

    const { error: deleteError } = await service.from('topic_resources').delete().eq('id', id)
    if (deleteError) throw new Error(deleteError.message)

    if (row.resource_type === 'file' && row.storage_path) {
      const bucket = row.storage_bucket || TOPIC_RESOURCE_BUCKET
      await service.storage.from(bucket).remove([row.storage_path])
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message === 'Authentication required' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
