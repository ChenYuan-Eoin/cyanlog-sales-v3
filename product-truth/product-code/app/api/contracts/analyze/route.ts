// POST /api/contracts/analyze
// Deprecated text-only review endpoint. Formal review must begin with a
// persisted contract so every result can bind the source file, ReviewRun,
// RuleSetSnapshot, execution plan and model invocation evidence.

import { NextRequest, NextResponse } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, _orgId: string) => (
    NextResponse.json({
      error: '旧文本直审入口已停用。请先创建合同并上传源文件，再从合同记录发起可审计审核。',
      code: 'CONTRACT_ANALYSIS_ENDPOINT_MOVED',
      canonicalEndpoint: '/api/contracts/:id/analyze',
      requiredFlow: [
        'POST /api/contracts',
        'POST /api/contracts/:id/analyze',
      ],
    }, { status: 410 })
  ))
}
