// REQ: F009-F012
// PURPOSE: 发布配置 API

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { getAIConfigKind } from '@/lib/configs/ai-config-kind'

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

// POST /api/configs/:id/publish - 发布配置
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const hasAccess = await verifyConfigAccess(id, user.id)
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

    if (config.type === 'AI_CONFIG' && getAIConfigKind(config.value) !== 'provider') {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        '模型应用与工具消费策略的专用校验和发布流程尚未验收，当前禁止通过通用接口发布'
      ))
    }

    const now = new Date().toISOString()
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

    // 更新状态为已发布
    const { data: updated, error } = await supabaseAdmin
      .from('configs')
      .update({
        status: 'PUBLISHED',
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Publish config error:', error)
      return errorResponse(createApiError('DB_ERROR', '发布配置失败'))
    }

    return successResponse(updated)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('Publish config error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
