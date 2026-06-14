// REQ: F009-F012
// PURPOSE: 配置中心 API - 列表查询和创建配置

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { configCreateSchema, validateConfigValue } from '@/lib/configs/validation'
import type { ConfigType, ConfigStatus } from '@/lib/configs/types'
import { sanitizeConfigRow } from '@/lib/configs/runtime'

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

// GET /api/configs - 获取配置列表（分页）
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const { searchParams } = new URL(req.url)

    const type = searchParams.get('type') as ConfigType | null
    const status = searchParams.get('status') as ConfigStatus | null
    // 分页参数
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // 获取用户当前组织
    const orgId = await getCurrentOrgId(user.id)
    if (!orgId) {
      return errorResponse('未找到所属组织', 400, 'NO_ORG')
    }

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
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    // 对 AI_CONFIG 类型的 api_key 进行脱敏处理
    const sanitizedConfigs = configs.map((config) => sanitizeConfigRow(config))

    return NextResponse.json({
      data: sanitizedConfigs,
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get configs error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// POST /api/configs - 创建配置
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const body = await req.json()
    const validated = configCreateSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse(
        '配置数据无效: ' + validated.error.issues.map((e) => e.message).join(', '),
        400,
        'INVALID_DATA'
      )
    }

    // 获取用户当前组织
    const orgId = await getCurrentOrgId(user.id)
    if (!orgId) {
      return errorResponse('未找到所属组织', 400, 'NO_ORG')
    }

    // 验证配置值
    const valueValidation = validateConfigValue(validated.data.type, validated.data.value)
    if (!valueValidation.valid) {
      return errorResponse(`配置值验证失败: ${valueValidation.error}`, 400, 'INVALID_VALUE')
    }

    // 检查 key 是否已存在（同一组织内）
    const { data: existing } = await supabaseAdmin
      .from('configs')
      .select('id')
      .eq('key', validated.data.key)
      .eq('org_id', orgId)
      .single()

    if (existing) {
      return errorResponse(`配置键 "${validated.data.key}" 已存在`, 409, 'DUPLICATE_KEY')
    }

    const normalizedValue = validated.data.type === 'AI_CONFIG'
      ? {
          ...validated.data.value,
          name: validated.data.name,
        }
      : validated.data.value

    const { data: config, error } = await supabaseAdmin
      .from('configs')
      .insert({
        ...validated.data,
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
      return errorResponse('创建配置失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(config, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Create config error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
