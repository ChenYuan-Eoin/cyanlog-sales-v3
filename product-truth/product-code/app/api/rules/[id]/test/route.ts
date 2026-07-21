// REQ:F006
// This endpoint formerly tested a separate `contract_rules` row and even
// reduced semantic rules to keyword matching. The canonical test endpoint
// verifies a saved rule_contract snapshot and records assertion evidence.

import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { legacyRuleControlPlaneGone } from '../../legacy-control-plane'

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req)
    return legacyRuleControlPlaneGone('旧测试', '/api/rules/test')
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return Response.json({ error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 })
    return Response.json({ error: '服务器错误', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
