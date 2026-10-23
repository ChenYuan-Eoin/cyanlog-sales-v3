import { assertDatabaseEnvironment } from '@/lib/database-environment'

type PostgrestFilterValue = string

export type MiddlewareRestClient = {
  selectRows<T>(
    table: string,
    filters: Record<string, PostgrestFilterValue>,
    select: string,
    limit?: number,
  ): Promise<T[]>
}

function readConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required for auth middleware')
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for auth middleware')
  }

  assertDatabaseEnvironment({
    databaseUrl: supabaseUrl,
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
  })

  return {
    endpoint: `${supabaseUrl.replace(/\/+$/, '')}/rest/v1`,
    serviceRoleKey,
  }
}

export function createMiddlewareRestClient(): MiddlewareRestClient {
  const { endpoint, serviceRoleKey } = readConfig()
  return {
    async selectRows<T>(
      table: string,
      filters: Record<string, PostgrestFilterValue>,
      select: string,
      limit = 1,
    ): Promise<T[]> {
      const search = new URLSearchParams()
      search.set('select', select)
      for (const [key, value] of Object.entries(filters)) {
        search.append(key, `eq.${value}`)
      }
      search.set('limit', String(limit))

      const response = await fetch(`${endpoint}/${encodeURIComponent(table)}?${search.toString()}`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`auth middleware query failed: ${table} returned ${response.status}`)
      }
      const payload = await response.json().catch(() => null)
      if (!Array.isArray(payload)) {
        throw new Error(`auth middleware query failed: ${table} returned invalid JSON`)
      }
      return payload as T[]
    },
  }
}
