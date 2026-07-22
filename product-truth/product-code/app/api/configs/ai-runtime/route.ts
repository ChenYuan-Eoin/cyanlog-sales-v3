import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api/common'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { getAIRuntimeReadiness } from '@/lib/ai/failover'
import type { AuthUser } from '@/lib/auth'

export const preferredRegion = 'sin1'

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { searchParams } = new URL(req.url)
    const readiness = await getAIRuntimeReadiness(orgId, {
      tool: searchParams.get('tool') || undefined,
      capability: searchParams.get('capability') || undefined,
      preferredProvider: searchParams.get('provider') || undefined,
    })

    return successResponse(readiness)
  })
}
