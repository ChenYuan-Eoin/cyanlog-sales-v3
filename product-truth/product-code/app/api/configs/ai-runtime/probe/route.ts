// REQ: F012
// PURPOSE: Test an AI provider draft without storing credentials.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { successResponse, errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { assessProviderRuntime, fetchOpenAICompatibleModelIds } from '@/lib/configs/ai-runtime-readiness'
import type { AuthUser } from '@/lib/auth'

const probeSchema = z.object({
  provider_kind: z.enum(['openai_compatible', 'builtin']).default('openai_compatible'),
  base_url: z.string().trim().optional(),
  api_key: z.string().optional(),
  model: z.string().trim().optional(),
})

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, _orgId: string) => {
    const body = await req.json().catch(() => null)
    const parsed = probeSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        `模型探测参数无效: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`
      ))
    }

    const assessment = await assessProviderRuntime({
      providerKind: parsed.data.provider_kind,
      baseUrl: parsed.data.base_url,
      apiKey: parsed.data.api_key,
      model: parsed.data.model,
      allowLocalCliFallback: false,
      checkRemoteHealth: true,
    })

    const availableModels = (
      parsed.data.provider_kind !== 'builtin'
      && (assessment.runtime_state === 'local_health_ok' || assessment.runtime_state === 'remote_health_ok')
    )
      ? await fetchOpenAICompatibleModelIds(
        parsed.data.base_url || '',
        parsed.data.api_key,
        undefined,
        assessment.local_endpoint ? 1200 : 3000
      )
      : []

    return successResponse({
      ...assessment,
      probe_scope: 'explicit_http_health_check',
      available_models: availableModels,
      credential_checked: parsed.data.provider_kind === 'builtin'
        ? 'not_required'
        : parsed.data.api_key
          ? 'provided'
          : 'missing',
    })
  })
}
