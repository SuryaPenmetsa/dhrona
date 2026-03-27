import { createClient } from '@supabase/supabase-js'

/** Service role client for admin APIs (bypasses RLS). */
export function createServiceClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function normalizeSupabaseUrl(url: string | undefined): string | undefined {
  if (!url) return url
  const trimmed = url.trim()
  const markdownMatch = trimmed.match(/^\[(https?:\/\/[^\]]+)\]\((https?:\/\/[^)]+)\)$/)
  if (markdownMatch) {
    return markdownMatch[2].replace(/\/$/, '')
  }
  return trimmed.replace(/\/$/, '')
}
