// REQ:F006
// PURPOSE: Rule detail API - get, update, delete single rule

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { isSchemaDriftError } from '@/lib/db-compat'

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
    category: z.string().optional(),
    code: z.string().optional(),
    engine: z.string().optional(),
    evidence: z.string().optional(),
    exception: z.string().optional(),
    pattern: z.string().optional(),
    field: z.string().optional(),
    operator: z.enum(['gt', 'lt', 'eq', 'contains']).optional(),
    output_template: z.string().optional(),
    rule_set: z.string().optional(),
    test_status: z.enum(['passed', 'failed', 'untested']).optional(),
    trigger_type: z.enum(['keyword', 'semantic', 'field', 'ratio', 'amount', 'duration']).optional(),
    value: z.union([z.string(), z.number()]).optional(),
    prompt: z.string().optional(),
  }).passthrough().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    let ruleResult = await supabaseAdmin
      .from('rules')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (ruleResult.error && isSchemaDriftError(ruleResult.error)) {
      ruleResult = await supabaseAdmin
        .from('rules')
        .select('*')
        .eq('id', id)
        .maybeSingle()
    }

    if (ruleResult.error) {
      console.error('Get rule error:', ruleResult.error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    if (!ruleResult.data) {
      return errorResponse('规则不存在', 404, 'NOT_FOUND')
    }

    return NextResponse.json(ruleResult.data)
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

    let updateResult = await supabaseAdmin
      .from('rules')
      .update({
        ...validated.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .maybeSingle()

    if (updateResult.error && isSchemaDriftError(updateResult.error)) {
      updateResult = await supabaseAdmin
        .from('rules')
        .update({
          ...validated.data,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .maybeSingle()
    }

    if (updateResult.error) {
      console.error('Update rule error:', updateResult.error)
      return errorResponse('更新规则失败', 500, 'DB_ERROR')
    }

    if (!updateResult.data) {
      return errorResponse('规则不存在', 404, 'NOT_FOUND')
    }

    return NextResponse.json(updateResult.data)
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

    let deleteResult = await supabaseAdmin
      .from('rules')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)

    if (deleteResult.error && isSchemaDriftError(deleteResult.error)) {
      deleteResult = await supabaseAdmin
        .from('rules')
        .delete()
        .eq('id', id)
    }

    if (deleteResult.error) {
      console.error('Delete rule error:', deleteResult.error)
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
