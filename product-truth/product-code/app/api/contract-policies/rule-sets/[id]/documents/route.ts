// GET /api/contract-policies/rule-sets/:id/documents
// POST /api/contract-policies/rule-sets/:id/documents
// RuleSetDocument is optional drafting/reference material. Saving it creates a
// new document version but cannot change the RuleSet release lifecycle; only an
// explicit frozen document id in a RuleSetSnapshot may enter formal evidence.

import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errorResponse, successResponse } from '@/lib/api/common'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { supabaseAdmin } from '@/lib/supabase'

const documentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  source_type: z.enum(['markdown', 'upload', 'github_reference', 'manual_note']).optional().default('markdown'),
  source_uri: z.string().trim().max(2000).optional().nullable(),
  content_markdown: z.string().max(200_000).default(''),
})

function hashContent(content: string) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

async function ensureRuleSet(ruleSetId: string, orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('contract_rule_sets')
    .select('id, version')
    .eq('id', ruleSetId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw error
  return data as { id: string; version: number | null } | null
}

async function nextDocumentVersion(ruleSetId: string) {
  const { data, error } = await supabaseAdmin
    .from('contract_rule_set_documents')
    .select('version')
    .eq('rule_set_id', ruleSetId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return Number(data?.version || 0) + 1
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'read')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:read 权限'))
    }

    const { id } = await params
    const ruleSet = await ensureRuleSet(id, orgId)
    if (!ruleSet) {
      return errorResponse(createApiError('NOT_FOUND', '规则集不存在'))
    }

    const { data, error } = await supabaseAdmin
      .from('contract_rule_set_documents')
      .select('*')
      .eq('org_id', orgId)
      .eq('rule_set_id', id)
      .neq('status', 'archived')
      .order('version', { ascending: false })

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则集文档失败'))
    }

    return successResponse(data || [])
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:write 权限'))
    }

    const { id } = await params
    const parsed = documentSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '规则集文档参数无效'))
    }

    const ruleSet = await ensureRuleSet(id, orgId)
    if (!ruleSet) {
      return errorResponse(createApiError('NOT_FOUND', '规则集不存在'))
    }

    const version = await nextDocumentVersion(id)
    const payload = parsed.data
    const contentHash = hashContent(payload.content_markdown)

    const { data, error } = await supabaseAdmin
      .from('contract_rule_set_documents')
      .insert({
        org_id: orgId,
        rule_set_id: id,
        title: payload.title,
        source_type: payload.source_type,
        source_uri: payload.source_uri || null,
        content_markdown: payload.content_markdown,
        content_hash: contentHash,
        version,
        status: 'draft',
        translation_status: payload.content_markdown.trim()
          ? 'needs_ai_translation'
          : 'not_started',
        translation_summary: {
          source: 'config_center_ruleset_document',
          requires_field_level_confirmation: true,
        },
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single()

    if (error || !data) {
      return errorResponse(createApiError('DB_ERROR', '保存规则集文档失败'))
    }

    return createdResponse(data)
  })
}
