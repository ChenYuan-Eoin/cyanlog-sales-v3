// REQ: F003 / WP92. Retire the legacy Feishu direct-write path.
// Directory mutations must use the provider-neutral immutable plan/apply/rollback route.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgDepartments,
  canMutateOrgUsers,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'

export const runtime = 'nodejs'

const RETIRED_MESSAGE = '旧版飞书组织直写接口已停用。请从“外部系统接入”检查目录读取范围、生成不可变差异并显式确认切换。'

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const requestedOrgId = req.headers.get('x-org-id')?.trim()
    const orgId = requestedOrgId || await getFreshDefaultOrgId(user.id)
    if (!orgId) {
      return NextResponse.json({ code: 'NO_ORGANIZATION', error: '当前账号没有可管理的系统组织。' }, { status: 400 })
    }

    const assignments = await getFreshUserScopedRoleAssignments(user.id)
    if (!canMutateOrgDepartments(assignments, orgId) || !canMutateOrgUsers(assignments, orgId)) {
      return NextResponse.json({ code: 'FORBIDDEN', error: '当前账号无权管理该组织目录。' }, { status: 403 })
    }

    return NextResponse.json(
      { code: 'DIRECTORY_CUTOVER_REQUIRED', error: RETIRED_MESSAGE },
      { status: 410 },
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return NextResponse.json({ code: 'UNAUTHORIZED', error: '请先登录。' }, { status: 401 })
    }
    console.error('legacy Feishu sync authorization failed', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ code: 'INTERNAL_ERROR', error: '组织目录权限校验失败。' }, { status: 500 })
  }
}
