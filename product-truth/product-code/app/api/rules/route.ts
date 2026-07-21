// REQ:F006
// Legacy rule CRUD boundary. Snapshot-backed `/api/rules/test` remains the
// canonical rule-test endpoint; business configuration lives under
// `/api/contract-policies/rules` only.

import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { legacyRuleControlPlaneGone } from './legacy-control-plane'

async function authenticatedGone(req: NextRequest, action: string) {
  try {
    await requireAuth(req)
    return legacyRuleControlPlaneGone(action)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return Response.json({ error: '未登录或登录已过期', code: 'UNAUTHORIZED' }, { status: 401 })
    }
    return Response.json({ error: '服务器内部错误', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return authenticatedGone(req, '列表')
}

export async function POST(req: NextRequest) {
  return authenticatedGone(req, '创建')
}
