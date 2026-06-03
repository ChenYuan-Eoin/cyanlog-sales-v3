// REQ: F009-F012
// PURPOSE: 发布配置 API

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

interface RouteParams {
  params: Promise<{ id: string }>
}

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

// POST /api/configs/:id/publish - 发布配置
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const hasAccess = await verifyConfigAccess(id, user.id)
    if (!hasAccess) {
      return errorResponse('配置不存在或无权限', 404, 'NOT_FOUND')
    }

    // 获取当前配置
    const { data: config } = await supabaseAdmin
      .from('configs')
      .select('*')
      .eq('id', id)
      .single()

    if (!config) {
      return errorResponse('配置不存在', 404, 'NOT_FOUND')
    }

    if (config.status === 'PUBLISHED') {
      return errorResponse('配置已处于发布状态', 400, 'ALREADY_PUBLISHED')
    }

    // 更新状态为已发布
    const { data: updated, error } = await supabaseAdmin
      .from('configs')
      .update({
        status: 'PUBLISHED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Publish config error:', error)
      return errorResponse('发布配置失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(updated)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Publish config error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
