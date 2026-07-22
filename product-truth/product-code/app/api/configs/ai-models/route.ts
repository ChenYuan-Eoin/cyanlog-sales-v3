import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { listAIProviderModels } from '@/lib/ai/provider-probe'
import { supabaseAdmin } from '@/lib/supabase'
import { mergeStoredAIConfigValue } from '@/lib/configs/runtime'
import { aiProviderConfigValueSchema } from '@/lib/configs/validation'
import type { AuthUser } from '@/lib/auth'
import type { AIConfigValue } from '@/lib/configs/types'

export const preferredRegion = 'sin1'

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const body = await req.json().catch(() => null)
    const value = body?.value || body?.config?.value || body
    const parsed = aiProviderConfigValueSchema.safeParse(value)

    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        `AI 配置草稿无效: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`
      ))
    }

    let probeValue: AIConfigValue = parsed.data
    if (typeof body?.config_id === 'string' && body.config_id) {
      const { data: storedConfig } = await supabaseAdmin
        .from('configs')
        .select('value, type')
        .eq('id', body.config_id)
        .eq('org_id', orgId)
        .maybeSingle()

      if (storedConfig?.type === 'AI_CONFIG') {
        probeValue = mergeStoredAIConfigValue(
          storedConfig.value as Record<string, unknown> | null,
          parsed.data as unknown as Record<string, unknown>
        ) as unknown as AIConfigValue
      }
    }

    const result = await listAIProviderModels(probeValue)
    return successResponse(result)
  })
}
