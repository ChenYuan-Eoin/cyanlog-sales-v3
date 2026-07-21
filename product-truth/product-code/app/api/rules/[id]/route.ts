// REQ:F006
// Legacy single-rule CRUD is intentionally gone. Do not adapt the former
// Prompt/field/engine payload to the canonical business rule contract.

import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { legacyRuleControlPlaneGone } from '../legacy-control-plane'

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
  return authenticatedGone(req, '详情')
}

export async function PUT(req: NextRequest) {
  return authenticatedGone(req, '更新')
}

export async function DELETE(req: NextRequest) {
  return authenticatedGone(req, '删除')
}
