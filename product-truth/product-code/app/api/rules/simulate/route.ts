// REQ:F006
// The former simulator returned legacy Level A/B/C rows without the saved
// rule_contract assertion and snapshot identity required by the publish gate.

import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { legacyRuleControlPlaneGone } from '../legacy-control-plane'

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req)
    return legacyRuleControlPlaneGone('旧模拟', '/api/rules/test')
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return Response.json({ error: '未登录或登录已过期', code: 'UNAUTHORIZED' }, { status: 401 })
    return Response.json({ error: '服务器内部错误', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
