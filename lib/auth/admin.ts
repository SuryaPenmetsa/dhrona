import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type AppRole = 'admin' | 'member'

export class AuthzError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new AuthzError('Authentication required', 401)
  }

  const service = createServiceClient()
  const { data: roleRow, error: roleError } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (roleError) {
    throw new AuthzError(roleError.message, 500)
  }
  if (!roleRow || roleRow.role !== 'admin') {
    throw new AuthzError('Admin access required', 403)
  }

  return { user, service }
}
