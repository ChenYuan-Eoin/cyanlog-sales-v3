import { createClient } from '@supabase/supabase-js'

// 懒加载：避免构建时静态分析触发错误
function getEnvVar(key: string): string {
  const value = process.env[key]
  if (!value && typeof window === 'undefined') {
    // 仅在服务端抛出错误，构建时可能延迟加载
    console.warn(`Missing env var: ${key}`)
  }
  return value || ''
}

// 客户端组件使用的匿名客户端（受RLS限制）
export const supabase = createClient(
  getEnvVar('NEXT_PUBLIC_SUPABASE_URL'),
  getEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY')
)

// 服务端API使用的Service Role客户端（绕过RLS，需自行验证权限）
export const supabaseAdmin = createClient(
  getEnvVar('NEXT_PUBLIC_SUPABASE_URL'),
  getEnvVar('SUPABASE_SERVICE_ROLE_KEY') || getEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY'), // fallback
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)
