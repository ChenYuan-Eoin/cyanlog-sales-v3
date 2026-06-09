// REQ: F009-F012
// PURPOSE: 配置详情、更新、删除 API

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { configUpdateSchema } from '@/lib/configs/validation'
import { validateConfigValue } from '@/lib/configs/validation'
import { mergeStoredAIConfigValue, sanitizeConfigRow } from '@/lib/configs/runtime'

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

// GET /api/configs/:id - 获取配置详情
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const { ok, config } = await verifyConfigAccess(id, user.id)
    if (!ok) {
      return errorResponse('配置不存在或无权限', 404, 'NOT_FOUND')
    }

    // 对 AI_CONFIG 类型的 api_key 进行脱敏处理
    return NextResponse.json(sanitizeConfigRow(config as { type: string; value?: Record<string, unknown> | null }))
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get config error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// PUT /api/configs/:id - 更新配置
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const { ok, config } = await verifyConfigAccess(id, user.id)
    if (!ok) {
      return errorResponse('配置不存在或无权限', 404, 'NOT_FOUND')
    }

    const body = await req.json()
    const validated = configUpdateSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse(
        '配置数据无效: ' + validated.error.issues.map((e) => e.message).join(', '),
        400,
        'INVALID_DATA'
      )
    }

    const type = (config as { type: 'CONTRACT_RULE' | 'TAX_RULE' | 'APPROVAL_RULE' | 'AI_CONFIG' | 'UI_THEME' }).type
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

    // 如果更新 value，需要验证
    if (nextValue) {
      const valueValidation = validateConfigValue(type, nextValue)
      if (!valueValidation.valid) {
        return errorResponse(`配置值验证失败: ${valueValidation.error}`, 400, 'INVALID_VALUE')
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
      return errorResponse('更新配置失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(updated)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Update config error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// DELETE /api/configs/:id - 删除配置
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const { ok } = await verifyConfigAccess(id, user.id)
    if (!ok) {
      return errorResponse('配置不存在或无权限', 404, 'NOT_FOUND')
    }

    const { error } = await supabaseAdmin.from('configs').delete().eq('id', id)

    if (error) {
      console.error('Delete config error:', error)
      return errorResponse('删除配置失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Delete config error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
