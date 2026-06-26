// REQ: F009-F012
// PURPOSE: 配置回滚 API

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'

interface RouteParams {
  params: Promise<{ id: string }>
}

const rollbackSchema = z.object({
  version: z.number().int().min(1, '版本号必须大于等于1'),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// 获取当前用户的组织 ID
async function getCurrentOrgId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('user_organizations')
    .select('org_id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .single()

  return data?.org_id || null
}

// 验证配置是否属于当前用户组织
async function verifyConfigAccess(configId: string, userId: string): Promise<boolean> {
  const orgId = await getCurrentOrgId(userId)
  if (!orgId) {
    return false
  }

  const { data: config } = await supabaseAdmin
    .from('configs')
    .select('id')
    .eq('id', configId)
    .eq('org_id', orgId)
    .single()

  return !!config
}

// POST /api/configs/:id/rollback - 回滚配置到指定版本
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const body = await req.json().catch(() => null)
    const validated = rollbackSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse(
        '请求参数无效: ' + validated.error.issues.map((e) => e.message).join(', '),
        400,
        'INVALID_DATA'
      )
    }

    const hasAccess = await verifyConfigAccess(id, user.id)
    if (!hasAccess) {
      return errorResponse('配置不存在或无权限', 404, 'NOT_FOUND')
    }

    const targetVersion = validated.data.version

    // 获取目标版本的历史记录
    const { data: versionRecord } = await supabaseAdmin
      .from('config_versions')
      .select('*')
      .eq('config_id', id)
      .eq('version', targetVersion)
      .single()

    if (!versionRecord) {
      return errorResponse(`版本 ${targetVersion} 不存在`, 404, 'VERSION_NOT_FOUND')
    }

    // 执行回滚：将当前配置更新为目标版本的值
    const { data: updated, error } = await supabaseAdmin
      .from('configs')
      .update({
        value: versionRecord.value,
        status: 'DRAFT', // 回滚后变为草稿状态，需要重新发布
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Rollback config error:', error)
      return errorResponse('回滚配置失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({
      success: true,
      message: `已回滚到版本 ${targetVersion}`,
      config: updated,
      rollbackFrom: versionRecord,
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Rollback config error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
