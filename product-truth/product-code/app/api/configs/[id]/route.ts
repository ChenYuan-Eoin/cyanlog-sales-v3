// REQ: F009-F012
// PURPOSE: 配置详情、更新、删除 API

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { configUpdateSchema } from '@/lib/configs/validation'
import { validateConfigValue } from '@/lib/configs/validation'
import { mergeStoredAIConfigValue, sanitizeConfigRow } from '@/lib/configs/runtime'
import { getAIConfigKind } from '@/lib/configs/ai-config-kind'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'

interface RouteParams {
  params: Promise<{ id: string }>
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
async function verifyConfigAccess(configId: string, userId: string): Promise<{ ok: boolean; orgId?: string; config?: unknown }> {
  const orgId = await getCurrentOrgId(userId)
  if (!orgId) {
    return { ok: false }
  }

  const { data: config } = await supabaseAdmin
    .from('configs')
    .select('*')
    .eq('id', configId)
    .eq('org_id', orgId)
    .single()

  if (!config) {
    return { ok: false }
  }

  return { ok: true, orgId, config }
}

function isProtectedAIAsset(config: unknown): boolean {
  const record = config as { type?: unknown; value?: Record<string, unknown> | null }
  return record.type === 'AI_CONFIG' && getAIConfigKind(record.value) !== 'provider'
}

// GET /api/configs/:id - 获取配置详情
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const { ok, config } = await verifyConfigAccess(id, user.id)
    if (!ok) {
      return errorResponse(createApiError('NOT_FOUND', '配置不存在或无权限'))
    }

    // 对 AI_CONFIG 类型的 api_key 进行脱敏处理
    return successResponse(sanitizeConfigRow(config as { type: string; value?: Record<string, unknown> | null }))
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('Get config error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}

// PUT /api/configs/:id - 更新配置
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const { ok, config } = await verifyConfigAccess(id, user.id)
    if (!ok) {
      return errorResponse(createApiError('NOT_FOUND', '配置不存在或无权限'))
    }

    const body = await req.json().catch(() => null)
    const validated = configUpdateSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse(
        createApiError(
          'VALIDATION_ERROR',
          '配置数据无效: ' + validated.error.issues.map((e) => e.message).join(', ')
        )
      )
    }

    const type = (config as { type: 'CONTRACT_RULE' | 'TAX_RULE' | 'APPROVAL_RULE' | 'AI_CONFIG' | 'UI_THEME' }).type
    if (isProtectedAIAsset(config)) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '模型应用与工具消费策略当前只读，专用校验和发布流程验收前禁止使用通用 Provider 接口修改'
      ))
    }
    const nextValue = validated.data.value
      ? (
          type === 'AI_CONFIG'
            ? mergeStoredAIConfigValue(
                (config as { value?: Record<string, unknown> }).value,
                {
                  ...validated.data.value,
                  ...(validated.data.name ? { name: validated.data.name } : {}),
                }
              )
            : validated.data.value
        )
      : undefined

    if (type === 'AI_CONFIG' && nextValue && getAIConfigKind(nextValue) !== 'provider') {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        'AI 配置资产 kind 不可通过通用 Provider 接口变更'
      ))
    }

    // 如果更新 value，需要验证
    if (nextValue) {
      const valueValidation = validateConfigValue(type, nextValue)
      if (!valueValidation.valid) {
        return errorResponse(createApiError('VALIDATION_ERROR', `配置值验证失败: ${valueValidation.error}`))
      }
    }

    const { data: updated, error } = await supabaseAdmin
      .from('configs')
      .update({
        ...validated.data,
        ...(nextValue ? { value: nextValue } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update config error:', error)
      return errorResponse(createApiError('DB_ERROR', '更新配置失败'))
    }

    return successResponse(updated)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('Update config error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}

// DELETE /api/configs/:id - 删除配置
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const { ok, config } = await verifyConfigAccess(id, user.id)
    if (!ok) {
      return errorResponse(createApiError('NOT_FOUND', '配置不存在或无权限'))
    }
    if (isProtectedAIAsset(config)) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '模型应用与工具消费策略当前只读，专用发布流程验收前禁止删除'
      ))
    }

    const { error } = await supabaseAdmin.from('configs').delete().eq('id', id)

    if (error) {
      console.error('Delete config error:', error)
      return errorResponse(createApiError('DB_ERROR', '删除配置失败'))
    }

    return successResponse({ deleted: true })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('Delete config error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
