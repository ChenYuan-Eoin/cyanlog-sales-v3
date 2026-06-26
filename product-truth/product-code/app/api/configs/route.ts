// REQ: F009-F012
// PURPOSE: 配置中心 API - 规范化示例
// Note: 使用 Node.js runtime

export const preferredRegion = 'sin1'

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { configCreateSchema, validateConfigValue } from '@/lib/configs/validation'
import type { ConfigType, ConfigStatus } from '@/lib/configs/types'
import { sanitizeConfigRow } from '@/lib/configs/runtime'
import {
  errorResponse,
  paginatedResponse,
  createdResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

// GET /api/configs - 获取配置列表（分页）
export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
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
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
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

    // 验证配置值
    const valueValidation = validateConfigValue(validated.data.type, validated.data.value)
    if (!valueValidation.valid) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', `配置值验证失败: ${valueValidation.error}`)
      )
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

    const normalizedValue =
      validated.data.type === 'AI_CONFIG'
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
      return errorResponse(createApiError('DB_ERROR', '创建配置失败'))
    }

    return createdResponse(config)
  })
}
