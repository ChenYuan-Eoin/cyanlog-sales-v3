// POST /api/contract-policies/rules/:id/translate
// Generate an AI translation draft for a config-center contract rule.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, successResponse } from '@/lib/api/common'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { generateTextWithFailover } from '@/lib/ai/failover'
import { inferRuleLifecycleStatus, inferRuleTranslationStatus, missingRulePublicationFields } from '@/lib/contracts/rule-publication'
import { recordModelInvocation, resolvePublishedModelPolicy } from '@/lib/contracts/model-policy'

const messageTemplateSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  suggestion: z.string().optional(),
  comment: z.string().optional(),
  negotiation_action: z.string().optional(),
  negotiation_required: z.boolean().optional(),
  owner_role: z.string().optional(),
  bottom_line: z.string().optional(),
}).optional()

const translationSchema = z.object({
  target_field: z.string().optional(),
  clause_category: z.string().optional(),
  field_hints: z.array(z.string()).optional(),
  semantic_prompt: z.string().optional(),
  message_template: messageTemplateSchema,
  notes: z.array(z.string()).optional(),
})

const translateRequestSchema = z.object({
  apply: z.boolean().optional().default(false),
  translation: translationSchema.optional(),
  source_model_invocation_id: z.string().optional(),
})

const TRANSLATED_FIELDS = [
  'target_field',
  'clause_category',
  'field_hints',
  'semantic_prompt',
  'message_template',
] as const
const RULE_TRANSLATION_TIMEOUT_MS = 15_000

function extractJsonObject(text: string): unknown {
  const trimmed = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('模型未返回 JSON 对象')
  }
  return JSON.parse(trimmed.slice(start, end + 1))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function buildPrompt(rule: Record<string, unknown>, missingFields: string[]) {
  return JSON.stringify({
    task: 'translate_config_center_contract_rule_to_executable_draft',
    constraints: [
      '生产规则源头是配置中心当前规则，不能引入外部规则覆盖阈值、编码或状态。',
      '只能补全 target_field、clause_category、field_hints、semantic_prompt、message_template、notes。',
      'message_template 必须包含客户可见 Word 批注文案、销售谈判动作、修改建议和谈判底线。',
      '输出必须是 JSON 对象，不要输出 Markdown。',
    ],
    expected_json_schema: {
      target_field: 'string',
      clause_category: 'string',
      field_hints: ['string'],
      semantic_prompt: 'string',
      message_template: {
        title: 'string',
        description: 'string',
        suggestion: 'string',
        comment: 'string',
        negotiation_action: 'string',
        negotiation_required: true,
        owner_role: 'sales|legal|finance|delivery|security',
        bottom_line: 'string',
      },
      notes: ['string'],
    },
    missing_fields: missingFields,
    rule,
  }, null, 2)
}

function normalizeTranslation(value: z.infer<typeof translationSchema>) {
  return {
    target_field: value.target_field?.trim() || undefined,
    clause_category: value.clause_category?.trim() || undefined,
    field_hints: value.field_hints?.map((item) => item.trim()).filter(Boolean),
    semantic_prompt: value.semantic_prompt?.trim() || undefined,
    message_template: value.message_template,
    notes: value.notes?.map((item) => item.trim()).filter(Boolean) || [],
  }
}

function normalizeForDiff(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForDiff(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, normalizeForDiff(item)])
    )
  }
  return value ?? null
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(normalizeForDiff(left)) === JSON.stringify(normalizeForDiff(right))
}

function buildTranslationDiff(before: Record<string, unknown>, after: Record<string, unknown>) {
  return TRANSLATED_FIELDS.map((field) => ({
    field,
    before: normalizeForDiff(before[field]),
    after: normalizeForDiff(after[field]),
    changed: !sameValue(before[field], after[field]),
  }))
}

async function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`规则转译超过 ${Math.round(timeoutMs / 1000)} 秒未返回，请检查模型配置或稍后重试`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const body = await req.json().catch(() => ({}))
  const parsedBody = translateRequestSchema.safeParse(body)
  if (!parsedBody.success) {
    return errorResponse(createApiError('VALIDATION_ERROR', '参数验证失败'))
  }

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

    const ruleRecord = asRecord(rule)
    const missingFields = missingRulePublicationFields(ruleRecord)
    const startedAt = Date.now()
    let modelPolicyId: string | null = null

    try {
      let invocationId: string | null = parsedBody.data.source_model_invocation_id || null
      let translated: z.infer<typeof translationSchema>

      if (parsedBody.data.translation) {
        translated = parsedBody.data.translation
      } else {
        const modelPolicy = await resolvePublishedModelPolicy(orgId, user.id)
        modelPolicyId = modelPolicy.id
        const result = await withHardTimeout(
          generateTextWithFailover(buildPrompt(ruleRecord, missingFields), {
            orgId,
            system: '你是 ONES 业务运营的合同审核规则转译助手。只输出合法 JSON，不要改写规则源，不要直接发布规则。',
            timeoutMs: RULE_TRANSLATION_TIMEOUT_MS,
          }, 1),
          RULE_TRANSLATION_TIMEOUT_MS
        )
        translated = translationSchema.parse(extractJsonObject(result.text))
        const preview = normalizeTranslation(translated)
        const previewRule: Record<string, unknown> = {
          ...ruleRecord,
          target_field: preview.target_field ?? ruleRecord.target_field,
          clause_category: preview.clause_category ?? ruleRecord.clause_category,
          field_hints: preview.field_hints?.length ? preview.field_hints : ruleRecord.field_hints,
          semantic_prompt: preview.semantic_prompt ?? ruleRecord.semantic_prompt,
          message_template: {
            ...asRecord(ruleRecord.message_template),
            ...asRecord(preview.message_template),
          },
        }
        const previewPublicationRule = {
          business_domain: asString(previewRule.business_domain),
          risk_level: asString(previewRule.risk_level),
          applicable_scenarios: asStringArray(previewRule.applicable_scenarios),
          scope: asString(previewRule.scope),
          engine_type: asString(previewRule.engine_type),
          target_field: asString(previewRule.target_field),
          clause_category: asString(previewRule.clause_category),
          field_hints: asStringArray(previewRule.field_hints),
          semantic_prompt: asString(previewRule.semantic_prompt),
          message_template: previewRule.message_template,
        }
        const previewTranslationStatus = inferRuleTranslationStatus(previewPublicationRule)
        const previewLifecycleStatus = inferRuleLifecycleStatus(previewPublicationRule)
        const invocation = await recordModelInvocation({
          orgId,
          provider: result.provider,
          model: result.model,
          phase: 'rule_translation',
          modelPolicyId,
          status: result.degraded ? 'degraded' : 'completed',
          degraded: result.degraded,
          latencyMs: Date.now() - startedAt,
          requestMeta: {
            rule_id: id,
            rule_code: ruleRecord.code,
            rule_version: ruleRecord.version,
            missing_fields_before: missingFields,
          },
          responseMeta: {
            provider_kind: result.providerKind,
            transport: result.transport,
            attempt_errors: result.attemptErrors || [],
            text_length: result.text.length,
            translation_status: previewTranslationStatus,
            lifecycle_status: previewLifecycleStatus,
            notes: preview.notes,
            applied: false,
          },
        })
        invocationId = invocation.id
      }

      const normalized = normalizeTranslation(translated)
      const nextRule = {
        ...ruleRecord,
        business_domain: ruleRecord.business_domain,
        risk_level: ruleRecord.risk_level,
        applicable_scenarios: ruleRecord.applicable_scenarios,
        scope: ruleRecord.scope,
        engine_type: ruleRecord.engine_type,
        target_field: normalized.target_field ?? ruleRecord.target_field,
        clause_category: normalized.clause_category ?? ruleRecord.clause_category,
        field_hints: normalized.field_hints?.length ? normalized.field_hints : ruleRecord.field_hints,
        semantic_prompt: normalized.semantic_prompt ?? ruleRecord.semantic_prompt,
        message_template: {
          ...asRecord(ruleRecord.message_template),
          ...asRecord(normalized.message_template),
        },
      }
      const nextPublicationRule = {
        business_domain: asString(nextRule.business_domain),
        risk_level: asString(nextRule.risk_level),
        applicable_scenarios: asStringArray(nextRule.applicable_scenarios),
        scope: asString(nextRule.scope),
        engine_type: asString(nextRule.engine_type),
        target_field: asString(nextRule.target_field),
        clause_category: asString(nextRule.clause_category),
        field_hints: asStringArray(nextRule.field_hints),
        semantic_prompt: asString(nextRule.semantic_prompt),
        message_template: nextRule.message_template,
      }
      const translationStatus = inferRuleTranslationStatus(nextPublicationRule)
      const lifecycleStatus = inferRuleLifecycleStatus(nextPublicationRule)
      const diff = buildTranslationDiff(ruleRecord, nextRule)

      if (!parsedBody.data.apply) {
        return successResponse({
          applied: false,
          translation: normalized,
          diff,
          translation_status: translationStatus,
          lifecycle_status: lifecycleStatus,
          model_invocation_id: invocationId,
        })
      }

      const nextVersion = Number(ruleRecord.version || 1) + 1
      const updatePayload = {
        target_field: nextRule.target_field || null,
        clause_category: nextRule.clause_category || null,
        field_hints: nextPublicationRule.field_hints,
        semantic_prompt: nextRule.semantic_prompt || null,
        message_template: nextRule.message_template || {},
        translation_status: translationStatus,
        translation_notes: [
          ...normalized.notes,
          invocationId
            ? `AI 转译草稿来自 model_invocation ${invocationId}，已由人工确认应用`
            : '人工确认应用转译草稿',
        ],
        lifecycle_status: lifecycleStatus,
        published_at: null,
        published_by: null,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      }

      const { data: updatedRule, error: updateError } = await supabaseAdmin
        .from('contract_rules_v2')
        .update(updatePayload)
        .eq('id', id)
        .eq('org_id', orgId)
        .select()
        .single()

      if (updateError || !updatedRule) {
        return errorResponse(createApiError('DB_ERROR', '保存转译草稿失败'))
      }

      await supabaseAdmin.from('contract_rule_snapshots').insert({
        rule_id: id,
        version: nextVersion,
        config_snapshot: updatedRule,
        released_by: null,
        released_at: null,
        release_note: invocationId
          ? `AI 转译草稿，人工确认应用，model_invocation=${invocationId}`
          : '人工确认应用转译草稿',
        status: 'draft',
      })

      return successResponse({
        applied: true,
        rule: updatedRule,
        translation: normalized,
        diff,
        translation_status: translationStatus,
        lifecycle_status: lifecycleStatus,
        model_invocation_id: invocationId,
      })
    } catch (translationError) {
      const message = translationError instanceof Error ? translationError.message : String(translationError)
      if (!parsedBody.data.translation) {
        await recordModelInvocation({
          orgId,
          provider: 'unavailable',
          model: 'none',
          phase: 'rule_translation',
          modelPolicyId,
          status: 'failed',
          degraded: true,
          latencyMs: Date.now() - startedAt,
          fallbackReason: 'rule_translation_model_unavailable_or_invalid',
          requestMeta: {
            rule_id: id,
            rule_code: ruleRecord.code,
            rule_version: ruleRecord.version,
            missing_fields_before: missingFields,
          },
          responseMeta: {},
          errorMessage: message,
        }).catch(() => null)
      }

      return errorResponse(createApiError('SERVICE_UNAVAILABLE', `规则转译失败: ${message}`))
    }
  })
}
