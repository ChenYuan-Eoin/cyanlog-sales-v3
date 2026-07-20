// REQ: F009-F012
// PURPOSE: 配置详情、更新、删除 API

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { configUpdateSchema, parseConfigValue } from '@/lib/configs/validation'
import {
  mergeStoredAIProviderValue,
  sanitizeConfigRow,
  withoutStoredApiKey,
} from '@/lib/configs/runtime'
import { getAIConfigKind } from '@/lib/configs/ai-config-kind'
import {
  getAIAssetId,
  isEditableAIConfigValue,
  isProviderCredentialValue,
} from '@/lib/configs/ai-platform'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { userHasFreshOrgConfigAccess, userHasOrgConfigAccess } from '@/lib/configs/access'
import { getDefaultOrgId, getFreshDefaultOrgId } from '@/lib/scoped-access'

interface RouteParams {
  params: Promise<{ id: string }>
}

// 获取当前用户的组织 ID
async function getCurrentOrgId(userId: string, fresh = false): Promise<string | null> {
  try {
    return fresh ? await getFreshDefaultOrgId(userId) : await getDefaultOrgId(userId)
  } catch {
    return null
  }
}

function isConfigCasConflict(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === 'PGRST116',
  )
}

// 验证配置是否属于当前用户组织
async function verifyConfigAccess(configId: string, orgId: string): Promise<{ ok: boolean; config?: unknown }> {
  const { data: config } = await supabaseAdmin
    .from('configs')
    .select('*')
    .eq('id', configId)
    .eq('org_id', orgId)
    .single()

  if (!config) {
    return { ok: false }
  }

  return { ok: true, config }
}

function isProtectedLegacyAIAsset(config: unknown): boolean {
  const record = config as { type?: unknown; value?: Record<string, unknown> | null }
  return record.type === 'AI_CONFIG' && !isEditableAIConfigValue(record.value)
}

function isImmutableAIAsset(config: unknown): boolean {
  const record = config as {
    type?: unknown
    status?: unknown
    value?: Record<string, unknown> | null
  }
  return record.type === 'AI_CONFIG'
    && (record.status === 'PUBLISHED' || record.status === 'ARCHIVED')
    && isEditableAIConfigValue(record.value)
}

// GET /api/configs/:id - 获取配置详情
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params
    const orgId = await getCurrentOrgId(user.id)
    if (!orgId) {
      return errorResponse(createApiError('NO_ORG'))
    }
    if (!await userHasOrgConfigAccess(user.id, orgId, 'read')) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const { ok, config } = await verifyConfigAccess(id, orgId)
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
    const orgId = await getCurrentOrgId(user.id, true)
    if (!orgId) {
      return errorResponse(createApiError('NO_ORG'))
    }
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const { ok, config } = await verifyConfigAccess(id, orgId)
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
    if (isProtectedLegacyAIAsset(config)) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '旧 Provider、旧模型应用、旧工具策略或未知 AI 资产保持只读；请使用六对象 AI 平台资产'
      ))
    }
    if (isImmutableAIAsset(config)) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '已发布或已归档的 AI 平台资产不可原地修改；请基于当前版本创建新草稿'
      ))
    }
    const currentValue = (config as { value?: Record<string, unknown> }).value
    const submittedAIValue = validated.data.value && type === 'AI_CONFIG'
      ? {
          ...(isProviderCredentialValue(currentValue)
            ? withoutStoredApiKey(currentValue || {})
            : currentValue),
          ...validated.data.value,
        }
      : null
    let nextValue = validated.data.value
      ? (type === 'AI_CONFIG'
          ? isProviderCredentialValue(currentValue)
            ? mergeStoredAIProviderValue(currentValue, submittedAIValue || {})
            : submittedAIValue || {}
          : validated.data.value)
      : undefined

    if (type === 'AI_CONFIG' && nextValue) {
      const currentKind = getAIConfigKind(currentValue)
      const nextKind = getAIConfigKind(nextValue)
      const currentAssetId = getAIAssetId(currentValue)
      const nextAssetId = getAIAssetId(nextValue)
      if (currentKind !== nextKind || currentAssetId !== nextAssetId) {
        return errorResponse(createApiError(
          'BUSINESS_RULE_VIOLATION',
          'AI 资产 kind 与 asset_id 是稳定身份，不能在编辑时变更'
        ))
      }
    }

    // 如果更新 value，需要验证并保存规范化后的解析结果。
    if (nextValue) {
      const valueValidation = parseConfigValue(type, nextValue)
      if (!valueValidation.valid) {
        return errorResponse(createApiError('VALIDATION_ERROR', `配置值验证失败: ${valueValidation.error}`))
      }
      nextValue = valueValidation.data || nextValue
    }

    const { data: updated, error } = await supabaseAdmin
      .from('configs')
      .update({
        ...validated.data,
        ...(nextValue ? { value: nextValue } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('status', 'DRAFT')
      .select()
      .single()

    if (error) {
      console.error('Update config error:', error)
      if (isConfigCasConflict(error)) {
        return errorResponse(createApiError(
          'BUSINESS_RULE_VIOLATION',
          '配置状态已变化，请刷新后基于当前版本继续编辑',
        ))
      }
      return errorResponse(createApiError('DB_ERROR', '更新配置失败'))
    }

    return successResponse(sanitizeConfigRow(updated))
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
    const orgId = await getCurrentOrgId(user.id, true)
    if (!orgId) {
      return errorResponse(createApiError('NO_ORG'))
    }
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const { ok, config } = await verifyConfigAccess(id, orgId)
    if (!ok) {
      return errorResponse(createApiError('NOT_FOUND', '配置不存在或无权限'))
    }
    if (isProtectedLegacyAIAsset(config)) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '旧 Provider、旧模型应用、旧工具策略或未知 AI 资产保持只读，禁止删除'
      ))
    }
    if (isImmutableAIAsset(config)) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '已发布或已归档的 AI 平台资产不可删除；请创建新草稿并完成受控版本切换'
      ))
    }

    const { error } = await supabaseAdmin
      .from('configs')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('status', 'DRAFT')
      .select('id')
      .single()

    if (error) {
      console.error('Delete config error:', error)
      if (isConfigCasConflict(error)) {
        return errorResponse(createApiError(
          'BUSINESS_RULE_VIOLATION',
          '配置状态已变化，请刷新后再删除草稿',
        ))
      }
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
