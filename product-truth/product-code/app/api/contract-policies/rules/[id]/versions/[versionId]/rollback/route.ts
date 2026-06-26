// POST /api/contract-policies/rules/:id/versions/:versionId/rollback
// 回滚到指定版本

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { z } from 'zod'

const rollbackVersionSchema = z.object({
  reason: z.string().max(500, '回滚原因不能超过500个字符').optional().default(''),
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
  const parsed = rollbackVersionSchema.safeParse(await readOptionalJson(req))
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
    const { reason } = parsed.data

    // 1. 获取目标版本
    const { data: targetVersion, error: targetError } = await supabaseAdmin
      .from('contract_rule_snapshots')
      .select('*')
      .eq('id', versionId)
      .eq('rule_id', id)
      .single()

    if (targetError || !targetVersion) {
      return errorResponse(createApiError('NOT_FOUND', '版本不存在'))
    }

    // 2. 获取当前发布的版本
    const { data: currentVersion } = await supabaseAdmin
      .from('contract_rule_snapshots')
      .select('*')
      .eq('rule_id', id)
      .eq('status', 'published')
      .order('released_at', { ascending: false })
      .limit(1)
      .single()

    // 3. 将当前版本标记为已回滚
    if (currentVersion && currentVersion.id !== versionId) {
      await supabaseAdmin
        .from('contract_rule_snapshots')
        .update({ status: 'rolled_back' })
        .eq('id', currentVersion.id)
    }

    // 4. 重新发布目标版本
    const { error: updateError } = await supabaseAdmin
      .from('contract_rule_snapshots')
      .update({
        status: 'published',
        released_by: user.id,
        released_at: new Date().toISOString(),
        release_note: `回滚至此版本。原因: ${reason || '未说明'}`,
      })
      .eq('id', versionId)

    if (updateError) {
      return errorResponse(createApiError('DB_ERROR', '回滚失败'))
    }

    // 5. 更新规则配置
    const { error: ruleError } = await supabaseAdmin
      .from('contract_rules_v2')
      .update({
        ...(targetVersion.config_snapshot || {}),
        id,
        org_id: orgId,
        version: targetVersion.version,
        published_by: user.id,
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)

    if (ruleError) {
      return errorResponse(createApiError('DB_ERROR', '更新规则配置失败'))
    }

    return successResponse({
      message: '回滚成功',
      version: targetVersion.version,
      from_version: currentVersion?.version || null,
    })
  })
}
