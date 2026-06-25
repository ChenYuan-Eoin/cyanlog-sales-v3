// GET /api/contracts/templates
// Contract draft template catalog for the draft workspace.

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api/common'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { CONTRACT_TEMPLATES } from '@/lib/contracts/templates'

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, _orgId: string) => {
    return successResponse(CONTRACT_TEMPLATES)
  })
}
