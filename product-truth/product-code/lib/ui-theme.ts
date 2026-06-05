import { cache } from 'react'

import { supabaseAdmin } from '@/lib/supabase'
import { DEFAULT_THEME, sanitizeThemeValue } from '@/lib/ui-theme-shared'

export const getPublishedUITheme = cache(async (token?: string) => {
  try {
    if (!token) {
      return DEFAULT_THEME
    }

    const { data: tokenRecord } = await supabaseAdmin
      .from('auth_tokens')
      .select('user_id')
      .eq('token', token)
      .maybeSingle()

    if (!tokenRecord?.user_id) {
      return DEFAULT_THEME
    }

    const { data: membership } = await supabaseAdmin
      .from('user_organizations')
      .select('org_id')
      .eq('user_id', tokenRecord.user_id)
      .eq('is_default', true)
      .maybeSingle()

    if (!membership?.org_id) {
      return DEFAULT_THEME
    }

    const { data } = await supabaseAdmin
      .from('configs')
      .select('value')
      .eq('org_id', membership.org_id)
      .eq('type', 'UI_THEME')
      .eq('status', 'PUBLISHED')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return sanitizeThemeValue((data?.value ?? undefined) as Record<string, unknown> | undefined)
  } catch {
    return DEFAULT_THEME
  }
})
