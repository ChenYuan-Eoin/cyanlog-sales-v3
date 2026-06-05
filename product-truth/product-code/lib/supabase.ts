import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function createLazyClient(factory: () => SupabaseClient): SupabaseClient {
  let client: SupabaseClient | null = null

  return new Proxy({} as SupabaseClient, {
    get(_target, prop, receiver) {
      client ??= factory()
      const value = Reflect.get(client as object, prop, receiver)
      return typeof value === 'function' ? value.bind(client) : value
    },
  })
}

function createBrowserSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required')
  }

  if (!supabaseAnonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required')
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

function createServerSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// 客户端组件使用的匿名客户端（受 RLS 限制）
export const supabase = createLazyClient(createBrowserSupabaseClient)

// 服务端 API 使用的 Service Role 客户端（绕过 RLS，需自行验证权限）
export const supabaseAdmin = createLazyClient(createServerSupabaseClient)
