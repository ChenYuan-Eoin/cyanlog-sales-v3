// /api/contract-policies/rules/:id
// GET / PATCH / DELETE 单条规则

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

const updateRuleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.enum(['ratio', 'amount', 'duration', 'enum', 'text']).optional(),
  engine_type: z.enum(['structured', 'semantic', 'hybrid']).optional(),
  target_field: z.string().optional().nullable(),
  clause_category: z.string().optional().nullable(),
  field_hints: z.array(z.string()).optional(),
  semantic_prompt: z.string().optional().nullable(),
  applicable_scenarios: z.array(z.string()).optional(),
  scope: z.enum(['org', 'dept', 'user']).optional(),
  is_active: z.boolean().optional(),
  priority: z.number().optional(),
  // Level A
  level_a_operator: z.enum(['>=', '<=', '=', '>', '<', 'contains', 'in']).optional(),
  level_a_threshold: z.number().optional(),
  level_a_unit: z.string().optional(),
  level_a_action: z.string().optional(),
  // Level B
  level_b_operator: z.enum(['>=', '<=', '=', '>', '<', 'contains', 'in']).optional(),
  level_b_threshold: z.number().optional(),
  level_b_unit: z.string().optional(),
  level_b_action: z.string().optional(),
  level_b_counterparty: z.string().optional(),
  // Level C
  level_c_operator: z.enum(['>=', '<=', '=', '>', '<', 'contains', 'in']).optional(),
  level_c_threshold: z.number().optional(),
  level_c_unit: z.string().optional(),
  level_c_action: z.string().optional(),
  level_c_message: z.string().optional(),
}).partial()

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params

    const { data: rule, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (error || !rule) {
      return errorResponse(createApiError('NOT_FOUND', '规则不存在'))
    }

    return successResponse(rule)
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = updateRuleSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', '参数验证失败')
      )
    }

    const { data: oldRule } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (!oldRule) {
      return errorResponse(createApiError('NOT_FOUND', '规则不存在'))
    }

    const nextVersion = (oldRule.version || 1) + 1
    const { data: rule, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .update({
        ...parsed.data,
        version: nextVersion,
        published_at: new Date().toISOString(),
        published_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error || !rule) {
      return errorResponse(createApiError('DB_ERROR', '更新规则失败'))
    }

    await supabaseAdmin.from('contract_rule_snapshots').insert({
      rule_id: id,
      version: nextVersion,
      config_snapshot: rule,
      released_by: user.id,
      released_at: new Date().toISOString(),
      release_note: '保存规则并立即生效',
      status: 'published',
    })

    return successResponse(rule)
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params

    const { data: oldRule } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    const nextVersion = (oldRule?.version || 1) + 1
    const { data: rule, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .update({
        is_active: false,
        version: nextVersion,
        published_at: new Date().toISOString(),
        published_by: user.id,
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '删除规则失败'))
    }

    if (rule) {
      await supabaseAdmin.from('contract_rule_snapshots').insert({
        rule_id: id,
        version: nextVersion,
        config_snapshot: rule,
        released_by: user.id,
        released_at: new Date().toISOString(),
        release_note: '停用规则',
        status: 'published',
      })
    }

    return successResponse({ id })
  })
}
