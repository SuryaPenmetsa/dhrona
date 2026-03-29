import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _cachedClient: SupabaseClient | null = null

/** Service role client for admin APIs (bypasses RLS). Reuses a singleton. */
export function createServiceClient() {
  if (_cachedClient) return _cachedClient

  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  _cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _cachedClient
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
