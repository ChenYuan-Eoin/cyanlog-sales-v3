import { cache } from 'react'

import { supabaseAdmin } from '@/lib/supabase'
import { DEFAULT_THEME, sanitizeThemeValue, type UIThemeConfigValue } from '@/lib/ui-theme-shared'
import { getOrgIdForToken } from '@/lib/configs/runtime'

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001'
const THEME_QUERY_TIMEOUT_MS = 150

async function loadPublishedThemeByOrgId(orgId: string) {
  const { data } = await supabaseAdmin
    .from('configs')
    .select('value')
    .eq('org_id', orgId)
    .eq('type', 'UI_THEME')
    .eq('status', 'PUBLISHED')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return sanitizeThemeValue((data?.value ?? undefined) as Record<string, unknown> | undefined)
}

async function getPublishedUIThemeInternal(token?: string): Promise<Required<UIThemeConfigValue>> {
  const orgId = await getOrgIdForToken(token)
  if (orgId) {
    return loadPublishedThemeByOrgId(orgId)
  }
  return loadPublishedThemeByOrgId(DEFAULT_ORG_ID)
}

export const getPublishedUITheme = cache(async (token?: string) => {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Theme query timeout')), THEME_QUERY_TIMEOUT_MS)
    })
    return await Promise.race([
      getPublishedUIThemeInternal(token),
      timeoutPromise,
    ])
  } catch {
    return DEFAULT_THEME
  }
})
