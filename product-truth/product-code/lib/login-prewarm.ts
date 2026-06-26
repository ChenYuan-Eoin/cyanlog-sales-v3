import { supabaseAdmin } from '@/lib/supabase'

export async function warmLoginRuntime() {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  await Promise.allSettled([
    supabaseAdmin.from('users').select('id').limit(1).maybeSingle(),
    supabaseAdmin.rpc('get_login_candidate_v1', {
      p_email: '__prewarm__@invalid.local',
      p_phone: null,
      p_ip_address: 'prewarm',
      p_since: since,
      p_account_limit: 5,
      p_ip_limit: 15,
    }),
    supabaseAdmin.rpc('login_with_password_v1', {
      p_email: null,
      p_phone: null,
      p_password: null,
      p_ip_address: 'prewarm',
      p_token_id: null,
      p_token: null,
      p_expires_at: null,
      p_since: since,
      p_account_limit: 5,
      p_ip_limit: 15,
    }),
  ])
}
