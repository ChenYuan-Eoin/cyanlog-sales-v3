// REQ:F006
// A single rule cannot be rolled back independently because doing so creates a
// mixed release. Restore or publish an immutable complete RuleSet instead.

import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { legacyRuleControlPlaneGone } from '../../legacy-control-plane'

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req)
    return legacyRuleControlPlaneGone('单条回滚', '/api/contract-policies/rule-sets')
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return Response.json({ error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 })
    return Response.json({ error: '服务器错误', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
