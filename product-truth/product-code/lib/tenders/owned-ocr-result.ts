import { redirect } from 'next/navigation'

import { getAuthUserByToken } from '@/lib/auth'
import { getServerAuthToken } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function loadOwnedOcrResultForServer(id: string) {
  const token = await getServerAuthToken()
  if (!token) {
    redirect('/login')
  }

  const user = await getAuthUserByToken(token)
  if (!user) {
    redirect('/login')
  }

  return supabaseAdmin
    .from('ocr_results')
    .select('id, original_file, extracted_text, key_info, confidence, status, created_at')
    .eq('id', id)
    .eq('created_by', user.id)
    .maybeSingle()
}
