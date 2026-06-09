// REQ:F006
// PURPOSE: Rule detail API - get, update, delete single rule

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

const ruleUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  rule_type: z.enum(['structured', 'semantic']).optional(),
  risk_level: z.enum(['red', 'yellow', 'green']).optional(),
  enabled: z.boolean().optional(),
  config: z.object({
    pattern: z.string().optional(),
    field: z.string().optional(),
    operator: z.enum(['gt', 'lt', 'eq', 'contains']).optional(),
    value: z.union([z.string(), z.number()]).optional(),
    prompt: z.string().optional(),
  }).optional(),
})

export async function GET(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    const { data: rule, error } = await supabaseAdmin
      .from('rules')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (error) {
      console.error('Get rule error:', error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    if (!rule) {
      return errorResponse('规则不存在', 404, 'NOT_FOUND')
    }

    return NextResponse.json(rule)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get rule error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function PUT(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    const body = await req.json()
    const validated = ruleUpdateSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse('规则数据无效', 400, 'INVALID_DATA')
    }

    const { data: rule, error } = await supabaseAdmin
      .from('rules')
      .update({
        ...validated.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) {
      console.error('Update rule error:', error)
      return errorResponse('更新规则失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(rule)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Update rule error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    const { error } = await supabaseAdmin
      .from('rules')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)

    if (error) {
      console.error('Delete rule error:', error)
      return errorResponse('删除规则失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({ success: true, message: '规则已删除' })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Delete rule error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
