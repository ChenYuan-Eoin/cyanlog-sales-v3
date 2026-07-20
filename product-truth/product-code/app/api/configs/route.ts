// REQ: F009-F012
// PURPOSE: 配置中心 API - 规范化示例
// Note: 使用 Node.js runtime

export const preferredRegion = 'sin1'

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { configCreateSchema, parseConfigValue } from '@/lib/configs/validation'
import type { ConfigType, ConfigStatus } from '@/lib/configs/types'
import {
  applyProviderRevisionCredential,
  isMaskedApiKey,
  sanitizeConfigRow,
  withoutStoredApiKey,
} from '@/lib/configs/runtime'
import {
  errorResponse,
  paginatedResponse,
  createdResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { userHasFreshOrgConfigAccess, userHasOrgConfigAccess } from '@/lib/configs/access'
import { getAIConfigKind, isAIPlatformAssetKind } from '@/lib/configs/ai-config-kind'
import { getAIAssetId } from '@/lib/configs/ai-platform'
import { getFreshDefaultOrgId } from '@/lib/scoped-access'

async function getCurrentWriteOrgId(userId: string): Promise<string | null> {
  try {
    return await getFreshDefaultOrgId(userId)
  } catch {
    return null
  }
}

// GET /api/configs - 获取配置列表（分页）
export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasOrgConfigAccess(user.id, orgId, 'read')) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const { searchParams } = new URL(req.url)

    const type = searchParams.get('type') as ConfigType | null
    const status = searchParams.get('status') as ConfigStatus | null
    // 分页参数
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    let query = supabaseAdmin
      .from('configs')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('type')
      .order('key')
      .range(offset, offset + limit - 1)

    if (type) {
      query = query.eq('type', type)
    }

    if (status) {
      query = query.eq('status', status)
    }

    const { data: configs, error, count } = await query

    if (error) {
      console.error('Get configs error:', error)
      return errorResponse(createApiError('DB_ERROR'))
    }

    // 对 AI_CONFIG 类型的 api_key 进行脱敏处理
    const sanitizedConfigs = configs.map((config) => sanitizeConfigRow(config))

    return paginatedResponse(sanitizedConfigs, count || 0, limit, offset)
  })
}

// POST /api/configs - 创建配置
export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, _cachedOrgId: string) => {
    const orgId = await getCurrentWriteOrgId(user.id)
    if (!orgId) {
      return errorResponse(createApiError('NO_ORG'))
    }
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const body = await req.json().catch(() => null)
    const validated = configCreateSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse(
        createApiError(
          'VALIDATION_ERROR',
          `配置数据无效: ${validated.error.issues.map((e) => e.message).join(', ')}`
        )
      )
    }

    let submittedValue = validated.data.value
    const submittedApiKey = typeof submittedValue.api_key === 'string' ? submittedValue.api_key : undefined
    if (submittedApiKey && isMaskedApiKey(submittedApiKey)) {
      if (validated.data.credential_action === 'reuse' || validated.data.credential_action === 'clear') {
        submittedValue = withoutStoredApiKey(submittedValue)
      } else {
        return errorResponse(createApiError(
          'VALIDATION_ERROR',
          '掩码 Token 不是可保存的凭据；请提交真实 Token 或使用受控修订复用'
        ))
      }
    }

    // Parse once and persist the parsed value, so trimmed identifiers and
    // canonical Provider URLs cannot diverge from later graph comparisons.
    let valueValidation = parseConfigValue(validated.data.type, submittedValue)
    if (!valueValidation.valid) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', `配置值验证失败: ${valueValidation.error}`)
      )
    }
    let normalizedValue = valueValidation.data || submittedValue

    if (
      validated.data.type === 'AI_CONFIG'
      && !isAIPlatformAssetKind(getAIConfigKind(normalizedValue))
    ) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '旧 Provider、旧模型应用、旧工具策略或未知 AI 资产保持只读；请使用六对象 AI 平台资产',
      ))
    }

    if (validated.data.revision_source_id && validated.data.credential_action) {
      if (
        validated.data.type !== 'AI_CONFIG'
        || getAIConfigKind(normalizedValue) !== 'provider_connection'
      ) {
        return errorResponse(createApiError(
          'BUSINESS_RULE_VIOLATION',
          '凭据修订协议只适用于 ProviderConnection'
        ))
      }

      const { data: revisionSource, error: revisionSourceError } = await supabaseAdmin
        .from('configs')
        .select('id, type, org_id, status, value')
        .eq('id', validated.data.revision_source_id)
        .eq('org_id', orgId)
        .eq('type', 'AI_CONFIG')
        .eq('status', 'PUBLISHED')
        .single()
      const sourceValue = revisionSource?.value && typeof revisionSource.value === 'object'
        ? revisionSource.value as Record<string, unknown>
        : null
      if (
        revisionSourceError
        || revisionSource?.status !== 'PUBLISHED'
        || !sourceValue
        || getAIConfigKind(sourceValue) !== 'provider_connection'
      ) {
        return errorResponse(createApiError(
          'NOT_FOUND',
          'Provider 修订来源必须是当前已发布的 ProviderConnection',
        ))
      }
      if (getAIAssetId(sourceValue) !== getAIAssetId(normalizedValue)) {
        return errorResponse(createApiError(
          'BUSINESS_RULE_VIOLATION',
          'Provider 修订来源与目标 asset_id 不一致'
        ))
      }

      const credentialResult = applyProviderRevisionCredential(
        sourceValue,
        normalizedValue,
        validated.data.credential_action,
      )
      if (!credentialResult.ok) {
        return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', credentialResult.error))
      }
      valueValidation = parseConfigValue('AI_CONFIG', credentialResult.value)
      if (!valueValidation.valid || !valueValidation.data) {
        return errorResponse(createApiError(
          'VALIDATION_ERROR',
          `Provider 修订值验证失败: ${valueValidation.error || '未知错误'}`
        ))
      }
      normalizedValue = valueValidation.data
    }

    // 检查 key 是否已存在（同一组织内）
    const { data: existing } = await supabaseAdmin
      .from('configs')
      .select('id')
      .eq('key', validated.data.key)
      .eq('org_id', orgId)
      .single()

    if (existing) {
      return errorResponse(
        createApiError('DUPLICATE_KEY', `配置键 "${validated.data.key}" 已存在`)
      )
    }

    const {
      revision_source_id: _revisionSourceId,
      credential_action: _credentialAction,
      ...storedConfig
    } = validated.data

    const { data: config, error } = await supabaseAdmin
      .from('configs')
      .insert({
        ...storedConfig,
        value: normalizedValue,
        org_id: orgId,
        created_by: user.id,
        status: 'DRAFT',
        version: 1,
      })
      .select()
      .single()

    if (error) {
      console.error('Create config error:', error)
      return errorResponse(createApiError('DB_ERROR', '创建配置失败'))
    }

    return createdResponse(sanitizeConfigRow(config))
  })
}
