// POST /api/contract-policies/rules/:id/versions/:versionId/publish
// 发布指定版本

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { z } from 'zod'

const publishVersionSchema = z.object({
  gray_release: z.boolean().optional().default(false),
  gray_end_at: z.string().datetime().nullable().optional().default(null),
})

async function readOptionalJson(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return {}
  }

  return req.json().catch(() => null)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const parsed = publishVersionSchema.safeParse(await readOptionalJson(req))
  if (!parsed.success) {
    return errorResponse(
      createApiError(
        'VALIDATION_ERROR',
        `参数验证失败: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`
      )
    )
  }

  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id, versionId } = await params
    const { gray_release, gray_end_at } = parsed.data

    // 1. 获取版本信息
    const { data: version, error: versionError } = await supabaseAdmin
      .from('contract_rule_snapshots')
      .select('*')
      .eq('id', versionId)
      .eq('rule_id', id)
      .single()

    if (versionError || !version) {
      return errorResponse(createApiError('NOT_FOUND', '版本不存在'))
    }

    // 2. 更新版本状态
    const { error: updateError } = await supabaseAdmin
      .from('contract_rule_snapshots')
      .update({
        status: 'published',
        released_by: user.id,
        released_at: new Date().toISOString(),
        is_gray_release: gray_release,
        gray_end_at: gray_end_at,
      })
      .eq('id', versionId)

    if (updateError) {
      return errorResponse(createApiError('DB_ERROR', '发布失败'))
    }

    // 3. 更新规则当前版本
    const { error: ruleError } = await supabaseAdmin
      .from('contract_rules_v2')
      .update({
        version: version.version,
        ...(version.config_snapshot || {}),
        org_id: orgId,
        id,
        published_by: user.id,
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)

    if (ruleError) {
      return errorResponse(createApiError('DB_ERROR', '更新规则版本失败'))
    }

    return successResponse({
      message: '发布成功',
      version: version.version,
      gray_release,
    })
  })
}
