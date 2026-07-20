// REQ: F009-F012
// PURPOSE: 发布配置 API

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { getAIConfigKind, isAIPlatformAssetKind } from '@/lib/configs/ai-config-kind'
import { sanitizeConfigRow, withoutStoredApiKey } from '@/lib/configs/runtime'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { getFreshDefaultOrgId } from '@/lib/scoped-access'
import { parseConfigValue } from '@/lib/configs/validation'
import {
  logicalAIAssetKey,
  validateAIPlatformPublishGraph,
  type AIPlatformConfigLike,
} from '@/lib/configs/ai-platform'

interface RouteParams {
  params: Promise<{ id: string }>
}

// 获取当前用户的组织 ID
async function getCurrentOrgId(userId: string): Promise<string | null> {
  try {
    return await getFreshDefaultOrgId(userId)
  } catch {
    return null
  }
}

// 验证配置是否属于当前用户组织
async function verifyConfigAccess(configId: string, orgId: string): Promise<boolean> {
  const { data: config } = await supabaseAdmin
    .from('configs')
    .select('id')
    .eq('id', configId)
    .eq('org_id', orgId)
    .single()

  return !!config
}

function isPublishCasConflict(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === 'PGRST116',
  )
}

async function restorePublishedRows(
  rows: AIPlatformConfigLike[],
  orgId: string,
): Promise<void> {
  for (const row of rows) {
    if (!row.id) continue
    await supabaseAdmin
      .from('configs')
      .update({
        status: 'PUBLISHED',
        value: row.value,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('org_id', orgId)
      .eq('status', 'ARCHIVED')
  }
}

async function archivePublishedRows(
  rows: AIPlatformConfigLike[],
  orgId: string,
  updatedAt: string,
): Promise<{ applied: AIPlatformConfigLike[]; error: unknown | null }> {
  const applied: AIPlatformConfigLike[] = []
  for (const row of rows) {
    if (!row.id) continue
    const kind = getAIConfigKind(row.value)
    const archivedValue = (kind === 'provider' || kind === 'provider_connection') && row.value
      ? withoutStoredApiKey(row.value)
      : row.value
    const { error } = await supabaseAdmin
      .from('configs')
      .update({
        status: 'ARCHIVED',
        value: archivedValue,
        updated_at: updatedAt,
      })
      .eq('id', row.id)
      .eq('org_id', orgId)
      .eq('status', 'PUBLISHED')
    if (error) return { applied, error }
    applied.push(row)
  }
  return { applied, error: null }
}

// POST /api/configs/:id/publish - 发布配置
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params
    const orgId = await getCurrentOrgId(user.id)
    if (!orgId) {
      return errorResponse(createApiError('NO_ORG'))
    }
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'publish')) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const hasAccess = await verifyConfigAccess(id, orgId)
    if (!hasAccess) {
      return errorResponse(createApiError('NOT_FOUND', '配置不存在或无权限'))
    }

    // 获取当前配置
    const { data: config } = await supabaseAdmin
      .from('configs')
      .select('*')
      .eq('id', id)
      .single()

    if (!config) {
      return errorResponse(createApiError('NOT_FOUND', '配置不存在'))
    }

    if (config.status === 'PUBLISHED') {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '配置已处于发布状态'))
    }
    if (config.status === 'ARCHIVED') {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '已归档配置不可重新发布；请基于历史版本创建新草稿'
      ))
    }

    const aiKind = config.type === 'AI_CONFIG' ? getAIConfigKind(config.value) : null
    const isPlatformCandidate = config.type === 'AI_CONFIG' && isAIPlatformAssetKind(aiKind)
    if (config.type === 'AI_CONFIG' && !isPlatformCandidate) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '旧 Provider、旧模型应用、旧工具策略或未知 AI 资产保持只读；请使用六对象 AI 平台资产'
      ))
    }
    let canonicalValue = config.value as Record<string, unknown> | null
    if (config.type === 'AI_CONFIG') {
      const valueValidation = parseConfigValue('AI_CONFIG', config.value || {})
      if (!valueValidation.valid) {
        return errorResponse(createApiError(
          'VALIDATION_ERROR',
          `AI 平台资产验证失败: ${valueValidation.error}`
        ))
      }
      canonicalValue = valueValidation.data || canonicalValue
    }

    let publishedAIConfigs: AIPlatformConfigLike[] = []
    if (isPlatformCandidate) {
      const { data: rows, error: rowsError } = await supabaseAdmin
        .from('configs')
        .select('id, key, name, value, status')
        .eq('org_id', orgId)
        .eq('type', 'AI_CONFIG')
        .eq('status', 'PUBLISHED')

      if (rowsError) {
        return errorResponse(createApiError('DB_ERROR', '读取 AI 平台发布依赖失败'))
      }

      publishedAIConfigs = (rows || []) as AIPlatformConfigLike[]
      const dependencyValidation = validateAIPlatformPublishGraph(
        { ...config, value: canonicalValue } as AIPlatformConfigLike,
        publishedAIConfigs,
      )
      if (!dependencyValidation.valid) {
        return errorResponse(createApiError(
          'BUSINESS_RULE_VIOLATION',
          'AI 平台发布依赖不完整',
          { reasons: dependencyValidation.reasons },
        ))
      }
    }

    const now = new Date().toISOString()
    const archivedRowsApplied: AIPlatformConfigLike[] = []
    if (isPlatformCandidate) {
      const candidateLogicalKey = logicalAIAssetKey(canonicalValue)
      const archivedPlatformRows = publishedAIConfigs
        .filter((row) => row.id && logicalAIAssetKey(row.value) === candidateLogicalKey && row.id !== id)
      const archiveResult = await archivePublishedRows(archivedPlatformRows, orgId, now)
      archivedRowsApplied.push(...archiveResult.applied)
      if (archiveResult.error) {
        console.error('Archive previous AI asset error:', archiveResult.error)
        await restorePublishedRows(archivedRowsApplied, orgId)
        return errorResponse(createApiError('DB_ERROR', '归档旧 AI 平台版本失败'))
      }
    } else {
      let archiveQuery = supabaseAdmin
        .from('configs')
        .update({
          status: 'ARCHIVED',
          updated_at: now,
        })
        .eq('org_id', config.org_id)
        .eq('type', config.type)
        .eq('status', 'PUBLISHED')
        .neq('id', id)

      // UI_THEME is the runtime BrandProfile. Only one profile can be active per org,
      // regardless of key, so browser favicon/logo/title resolution is unambiguous.
      if (config.type !== 'UI_THEME') {
        archiveQuery = archiveQuery.eq('key', config.key)
      }

      const { error: archiveError } = await archiveQuery

      if (archiveError) {
        console.error('Archive previous config error:', archiveError)
        return errorResponse(createApiError('DB_ERROR', '归档旧发布配置失败'))
      }
    }

    // 更新状态为已发布
    const { data: updated, error } = await supabaseAdmin
      .from('configs')
      .update({
        status: 'PUBLISHED',
        ...(config.type === 'AI_CONFIG' && canonicalValue ? { value: canonicalValue } : {}),
        updated_at: now,
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('status', 'DRAFT')
      .select()
      .single()

    if (error) {
      console.error('Publish config error:', error)
      // The generic configs store has no transaction RPC. Restore the previous
      // published logical version on failure so a revision cannot leave the
      // organization without an active asset. A compare-and-set miss means
      // another writer already changed the candidate; restoring an old secret
      // in that case would resurrect an archived credential.
      if (isPublishCasConflict(error)) {
        return errorResponse(createApiError(
          'BUSINESS_RULE_VIOLATION',
          '配置状态已变化，请刷新后重新发布',
        ))
      }
      await restorePublishedRows(archivedRowsApplied, orgId)
      return errorResponse(createApiError('DB_ERROR', '发布配置失败'))
    }

    return successResponse(sanitizeConfigRow(updated))
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('Publish config error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
