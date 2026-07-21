// REQ:F006
// The former endpoint inferred "semantic/structured" from a legacy category
// column and returned fabricated zero hit rates. A future analytics endpoint
// must aggregate immutable RuleSet snapshots and real ReviewRun decisions.

import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req)
    return Response.json({
      error: '旧规则统计入口已停用。当前没有足够的 ReviewRun 与规则快照证据，不能展示伪命中率或机器规则类型。',
      code: 'RULE_ANALYTICS_NOT_AVAILABLE',
      canonicalEndpoint: null,
      replacementContract: 'RuleSetSnapshot + RuleSnapshot + ReviewRun + persisted rule decisions',
    }, { status: 410 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return Response.json({ error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 })
    return Response.json({ error: '服务器错误', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
