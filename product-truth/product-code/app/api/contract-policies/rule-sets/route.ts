// GET /api/contract-policies/rule-sets
// POST /api/contract-policies/rule-sets
// F009 RuleSet assets. Rule sets are the first-class container for rules and
// documents; individual rules remain in contract_rules_v2.

import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errorResponse, successResponse } from '@/lib/api/common'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const ruleSetSchema = z.object({
  code: z.string().trim().min(1).max(80).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  applicable_scenario: z.string().trim().max(120).optional().nullable(),
  priority: z.number().int().optional().default(100),
  is_default: z.boolean().optional().default(false),
})

type RuleSetRow = {
  id: string
  org_id: string
  code: string
  name: string
  description: string | null
  applicable_scenario: string | null
  priority: number | null
  is_default: boolean | null
  is_active: boolean
  version: number
  lifecycle_status: string
  translation_status: string
  published_at: string | null
  published_by: string | null
  release_note: string | null
  metadata: unknown
  created_by: string | null
  created_at: string
  updated_at: string
}

type RuleSetDocumentRow = {
  id: string
  org_id: string
  rule_set_id: string
  title: string
  source_type: string
  source_uri: string | null
  content_markdown: string
  content_hash: string
  version: number
  status: string
  translation_status: string
  translation_diff: unknown
  translation_summary: unknown
  last_translation_invocation_id: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

type RuleRow = {
  rule_set_id: string | null
  lifecycle_status: string | null
  translation_status: string | null
  is_active: boolean | null
  published_at: string | null
}

function hashContent(content: string) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function isPublishedRule(rule: RuleRow) {
  return Boolean(
    rule.is_active
    && rule.lifecycle_status === 'published'
    && rule.translation_status === 'ready'
    && rule.published_at
  )
}

function isReadyRule(rule: RuleRow) {
  return rule.translation_status === 'ready'
}

function isBlockedRule(rule: RuleRow) {
  return !isPublishedRule(rule)
}

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const [setsResult, docsResult, rulesResult] = await Promise.all([
      supabaseAdmin
        .from('contract_rule_sets')
        .select('id, org_id, code, name, description, applicable_scenario, priority, is_default, is_active, version, lifecycle_status, translation_status, published_at, published_by, release_note, metadata, created_by, created_at, updated_at')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .order('code', { ascending: true }),
      supabaseAdmin
        .from('contract_rule_set_documents')
        .select('id, org_id, rule_set_id, title, source_type, source_uri, content_markdown, content_hash, version, status, translation_status, translation_diff, translation_summary, last_translation_invocation_id, created_by, updated_by, created_at, updated_at')
        .eq('org_id', orgId)
        .neq('status', 'archived')
        .order('version', { ascending: false }),
      supabaseAdmin
        .from('contract_rules_v2')
        .select('rule_set_id, lifecycle_status, translation_status, is_active, published_at')
        .eq('org_id', orgId)
        .eq('is_active', true),
    ])

    if (setsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则集失败'))
    }
    if (docsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则集文档失败'))
    }
    if (rulesResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则统计失败'))
    }

    const docsBySetId = new Map<string, RuleSetDocumentRow>()
    for (const doc of (docsResult.data || []) as RuleSetDocumentRow[]) {
      if (!docsBySetId.has(doc.rule_set_id)) {
        docsBySetId.set(doc.rule_set_id, doc)
      }
    }

    const rulesBySetId = new Map<string, RuleRow[]>()
    for (const rule of (rulesResult.data || []) as RuleRow[]) {
      if (!rule.rule_set_id) continue
      rulesBySetId.set(rule.rule_set_id, [...(rulesBySetId.get(rule.rule_set_id) || []), rule])
    }

    const ruleSets = ((setsResult.data || []) as RuleSetRow[]).map((set) => {
      const setRules = rulesBySetId.get(set.id) || []
      return {
        ...set,
        latest_document: docsBySetId.get(set.id) || null,
        rule_count: setRules.length,
        published_rule_count: setRules.filter(isPublishedRule).length,
        ready_rule_count: setRules.filter(isReadyRule).length,
        blocked_rule_count: setRules.filter(isBlockedRule).length,
      }
    })

    return successResponse(ruleSets)
  })
}

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const parsed = ruleSetSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '规则集参数无效'))
    }

    const payload = parsed.data
    const { data, error } = await supabaseAdmin
      .from('contract_rule_sets')
      .insert({
        org_id: orgId,
        created_by: user.id,
        code: payload.code,
        name: payload.name,
        description: payload.description || null,
        applicable_scenario: payload.applicable_scenario || 'standard_contract_review',
        priority: payload.priority,
        is_default: payload.is_default,
        is_active: true,
        lifecycle_status: 'draft',
        translation_status: 'not_started',
        metadata: {
          created_from: 'config_center_ruleset_api',
          content_hash: hashContent(`${payload.code}:${payload.name}:${payload.description || ''}`),
        },
      })
      .select()
      .single()

    if (error || !data) {
      return errorResponse(createApiError('DB_ERROR', '创建规则集失败'))
    }

    return createdResponse(data)
  })
}
