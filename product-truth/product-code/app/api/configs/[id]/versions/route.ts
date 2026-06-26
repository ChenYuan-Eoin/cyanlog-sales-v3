// REQ: F009-F012
// PURPOSE: 获取配置版本历史 API

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
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

// GET /api/configs/:id/versions - 获取配置版本历史
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const hasAccess = await verifyConfigAccess(id, user.id)
    if (!hasAccess) {
      return errorResponse(createApiError('NOT_FOUND', '配置不存在或无权限'))
    }

    const { data: versions, error } = await supabaseAdmin
      .from('config_versions')
      .select('*')
      .eq('config_id', id)
      .order('version', { ascending: false })

    if (error) {
      console.error('Get config versions error:', error)
      return errorResponse(createApiError('DB_ERROR', '获取版本历史失败'))
    }

    return successResponse(versions || [])
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('Get config versions error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
