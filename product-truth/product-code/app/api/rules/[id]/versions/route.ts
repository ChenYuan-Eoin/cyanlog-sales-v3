// REQ:F006
// Legacy per-rule version publication is removed. Canonical publication is
// atomic at the complete RuleSet boundary.

import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { legacyRuleControlPlaneGone } from '../../legacy-control-plane'

async function authenticatedGone(req: NextRequest) {
  try {
    await requireAuth(req)
    return legacyRuleControlPlaneGone('单条版本发布', '/api/contract-policies/rule-sets')
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return Response.json({ error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 })
    return Response.json({ error: '服务器错误', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return authenticatedGone(req)
}

export async function POST(req: NextRequest) {
  return authenticatedGone(req)
}
