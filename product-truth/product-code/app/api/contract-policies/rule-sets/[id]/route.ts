// GET /api/contract-policies/rule-sets/:id
// PATCH /api/contract-policies/rule-sets/:id
// DELETE /api/contract-policies/rule-sets/:id

import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, successResponse } from '@/lib/api/common'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const updateRuleSetSchema = z.object({
  code: z.string().trim().min(1).max(80).regex(/^[A-Z0-9_-]+$/).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  applicable_scenario: z.string().trim().max(120).optional().nullable(),
  priority: z.number().int().optional(),
  is_default: z.boolean().optional(),
}).partial()

function hashContent(content: string) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const { data, error } = await supabaseAdmin
      .from('contract_rule_sets')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .single()

    if (error || !data) {
      return errorResponse(createApiError('NOT_FOUND', '规则集不存在'))
    }

    return successResponse(data)
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = updateRuleSetSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '规则集参数无效'))
    }

    const { data: oldRuleSet } = await supabaseAdmin
      .from('contract_rule_sets')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .single()

    if (!oldRuleSet) {
      return errorResponse(createApiError('NOT_FOUND', '规则集不存在'))
    }

    const nextVersion = (oldRuleSet.version || 1) + 1
    const merged = {
      ...oldRuleSet,
      ...parsed.data,
    }
    const metadata = {
      ...(oldRuleSet.metadata && typeof oldRuleSet.metadata === 'object' && !Array.isArray(oldRuleSet.metadata)
        ? oldRuleSet.metadata
        : {}),
      content_hash: hashContent(`${merged.code}:${merged.name}:${merged.description || ''}`),
      updated_from: 'config_center_ruleset_api',
    }

    const { data, error } = await supabaseAdmin
      .from('contract_rule_sets')
      .update({
        ...parsed.data,
        version: nextVersion,
        lifecycle_status: 'draft',
        translation_status: 'needs_ai_translation',
        published_at: null,
        published_by: null,
        metadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error || !data) {
      return errorResponse(createApiError('DB_ERROR', '更新规则集失败'))
    }

    return successResponse(data)
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const { data: oldRuleSet } = await supabaseAdmin
      .from('contract_rule_sets')
      .select('id, version')
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .single()

    if (!oldRuleSet) {
      return errorResponse(createApiError('NOT_FOUND', '规则集不存在'))
    }

    const { data, error } = await supabaseAdmin
      .from('contract_rule_sets')
      .update({
        is_active: false,
        lifecycle_status: 'archived',
        version: (oldRuleSet.version || 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id')
      .single()

    if (error || !data) {
      return errorResponse(createApiError('DB_ERROR', '停用规则集失败'))
    }

    return successResponse({ id })
  })
}
