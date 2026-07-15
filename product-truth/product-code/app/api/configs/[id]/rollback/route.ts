// REQ: F009-F012
// PURPOSE: 配置回滚 API

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { getAIConfigKind } from '@/lib/configs/ai-config-kind'
import {
  sanitizeConfigRow,
  sanitizeConfigVersionRow,
  mergeStoredAIProviderValue,
  withoutStoredApiKey,
} from '@/lib/configs/runtime'
import { validateConfigValue } from '@/lib/configs/validation'
import type { ConfigType } from '@/lib/configs/types'
import { userHasOrgConfigAccess } from '@/lib/configs/access'
import { getDefaultOrgId } from '@/lib/scoped-access'

interface RouteParams {
  params: Promise<{ id: string }>
}

const rollbackSchema = z.object({
  version: z.number().int().min(1, '版本号必须大于等于1'),
})

// 获取当前用户的组织 ID
async function getCurrentOrgId(userId: string): Promise<string | null> {
  try {
    return await getDefaultOrgId(userId)
  } catch {
    return null
  }
}

// 验证配置是否属于当前用户组织
type StoredConfig = {
  id: string
  type: ConfigType
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  value: Record<string, unknown> | null
}

async function verifyConfigAccess(
  configId: string,
  orgId: string
): Promise<{ ok: boolean; config?: StoredConfig }> {
  const { data: config } = await supabaseAdmin
    .from('configs')
    .select('id, type, status, value')
    .eq('id', configId)
    .eq('org_id', orgId)
    .single()

  return config ? { ok: true, config: config as StoredConfig } : { ok: false }
}

// POST /api/configs/:id/rollback - 回滚配置到指定版本
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const orgId = await getCurrentOrgId(user.id)
    if (!orgId) {
      return errorResponse(createApiError('NO_ORG'))
    }
    if (!await userHasOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const body = await req.json().catch(() => null)
    const validated = rollbackSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse(
        createApiError(
          'VALIDATION_ERROR',
          '请求参数无效: ' + validated.error.issues.map((e) => e.message).join(', ')
        )
      )
    }

    const access = await verifyConfigAccess(id, orgId)
    if (!access.ok || !access.config) {
      return errorResponse(createApiError('NOT_FOUND', '配置不存在或无权限'))
    }

    if (
      access.config.type === 'AI_CONFIG'
      && getAIConfigKind(access.config.value) !== 'provider'
    ) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '模型应用与工具消费策略当前只读，专用校验和发布流程验收前禁止回滚'
      ))
    }
    if (
      access.config.type === 'AI_CONFIG'
      && access.config.status === 'PUBLISHED'
      && getAIConfigKind(access.config.value) === 'provider'
    ) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '已发布 Provider 不可原地回滚；必须创建独立草稿版本并经显式发布后切换'
      ))
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
      return errorResponse(createApiError('NOT_FOUND', `版本 ${targetVersion} 不存在`))
    }

    const storedVersionValue = versionRecord.value && typeof versionRecord.value === 'object'
      ? versionRecord.value as Record<string, unknown>
      : {}
    const historicalWithoutApiKey = withoutStoredApiKey(storedVersionValue)
    const nextValue = access.config.type === 'AI_CONFIG'
      ? mergeStoredAIProviderValue(access.config.value, historicalWithoutApiKey)
      : storedVersionValue

    if (
      access.config.type === 'AI_CONFIG'
      && getAIConfigKind(nextValue) !== 'provider'
    ) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        'AI 配置历史版本不是 Provider，禁止通过通用回滚接口恢复'
      ))
    }

    const valueValidation = validateConfigValue(access.config.type, nextValue)
    if (!valueValidation.valid) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        `目标版本配置值验证失败: ${valueValidation.error}`
      ))
    }

    // 历史版本永远不是密钥来源；仅相同凭据绑定可沿用当前密钥。
    const { data: updated, error } = await supabaseAdmin
      .from('configs')
      .update({
        value: nextValue,
        status: 'DRAFT', // 回滚后变为草稿状态，需要重新发布
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Rollback config error:', error)
      return errorResponse(createApiError('DB_ERROR', '回滚配置失败'))
    }

    return successResponse({
      message: `已回滚到版本 ${targetVersion}`,
      config: sanitizeConfigRow(updated),
      rollbackFrom: sanitizeConfigVersionRow(access.config.type, versionRecord),
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('Rollback config error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
