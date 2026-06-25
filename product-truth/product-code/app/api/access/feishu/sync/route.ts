// REQ: F003 自主可控 + RBAC
// PURPOSE: 飞书部门结构同步
// 权限要求: 组织管理员（SUPER_ADMIN / SALES_OPS / ADMIN 或拥有 admin:access/org:write 权限）

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canManageOrg, getUserScopedRoleAssignments } from '@/lib/scoped-access'

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireAuth(req)
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }

  const assignments = await getUserScopedRoleAssignments(user.id)

  if (!canManageOrg(assignments)) {
    return NextResponse.json(
      { error: '需要组织管理员权限' },
      { status: 403 }
    )
  }

  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) {
    return NextResponse.json(
      {
        error: '飞书未配置：缺少 FEISHU_APP_ID / FEISHU_APP_SECRET 环境变量',
        hint: '在 .env.local 中配置后重启服务',
      },
      { status: 503 }
    )
  }

  // 占位实现：真实同步需要调用飞书 OpenAPI 拉取部门列表
  // 接入步骤（待实施）：
  // 1) POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
  // 2) GET  https://open.feishu.cn/open-apis/contact/v3/departments?parent_department_id=0
  // 3) 递归获取子部门
  // 4) UPSERT 到 public.departments（source='feishu'，external_id 存飞书 department_id）

  return NextResponse.json({
    success: true,
    imported: 0,
    message: '飞书凭证已检测到，但同步逻辑待实施（占位返回）',
  })
}
