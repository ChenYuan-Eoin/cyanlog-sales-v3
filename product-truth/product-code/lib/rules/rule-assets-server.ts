import 'server-only'

import { supabaseAdmin } from '@/lib/supabase'
import type {
  ContractRuleAsset,
  ContractRuleAssetSummary,
  ContractRuleLatestEvaluation,
  ContractRuleSetAsset,
} from '@/types/contract-rule-assets'

function normalizeRule(row: Record<string, unknown>): ContractRuleAsset {
  const numeric = (value: unknown) => value === null || value === undefined ? null : Number(value)

  return {
    ...row,
    level_a_threshold: numeric(row.level_a_threshold),
    level_b_threshold: numeric(row.level_b_threshold),
    level_c_threshold: numeric(row.level_c_threshold),
    applicable_scenarios: Array.isArray(row.applicable_scenarios) ? row.applicable_scenarios : [],
    approval_roles: Array.isArray(row.approval_roles) ? row.approval_roles : [],
    field_hints: Array.isArray(row.field_hints) ? row.field_hints : [],
    message_template: row.message_template && typeof row.message_template === 'object' ? row.message_template : {},
    translation_notes: Array.isArray(row.translation_notes) ? row.translation_notes : [],
    translation_diff: Array.isArray(row.translation_diff) ? row.translation_diff : [],
  } as ContractRuleAsset
}

export async function loadRuleSetAssets(orgId: string, includeArchived = false) {
  let setQuery = supabaseAdmin
    .from('contract_rule_sets')
    .select('*')
    .eq('org_id', orgId)
    .order('priority', { ascending: false })
    .order('name')

  let ruleQuery = supabaseAdmin
    .from('contract_rules_v2')
    .select('*')
    .eq('org_id', orgId)
    .order('priority', { ascending: false })
    .order('code')

  if (!includeArchived) {
    setQuery = setQuery.neq('lifecycle_status', 'archived')
    ruleQuery = ruleQuery.neq('lifecycle_status', 'archived')
  }

  const [
    { data: setRows, error: setError },
    { data: ruleRows, error: ruleError },
    { data: evalRows, error: evalError },
    { data: bundle, error: bundleError },
  ] = await Promise.all([
    setQuery,
    ruleQuery,
    supabaseAdmin
      .from('contract_rule_eval_runs')
      .select('id,rule_id,status,mode,provider,degraded,created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('contract_skill_bundles')
      .select('id,key,version,status,is_current,rule_snapshot_ids,rule_set_snapshot_ids,published_at,compiled_hash')
      .eq('org_id', orgId)
      .eq('key', 'CONTRACT_REVIEW_DEFAULT')
      .eq('status', 'published')
      .eq('is_current', true)
      .maybeSingle(),
  ])

  if (setError) throw setError
  if (ruleError) throw ruleError
  if (evalError) throw evalError
  if (bundleError) throw bundleError

  const latestEvaluationByRule = new Map<string, ContractRuleLatestEvaluation>()
  for (const row of evalRows || []) {
    if (!latestEvaluationByRule.has(row.rule_id)) {
      latestEvaluationByRule.set(row.rule_id, {
        id: row.id,
        status: row.status as ContractRuleLatestEvaluation['status'],
        mode: row.mode as ContractRuleLatestEvaluation['mode'],
        provider: row.provider,
        degraded: Boolean(row.degraded),
        created_at: row.created_at,
      })
    }
  }

  const rules = (ruleRows || []).map((row) => {
    const rule = normalizeRule(row as Record<string, unknown>)
    const latestEvaluation = latestEvaluationByRule.get(rule.id)
    if (
      latestEvaluation
      && new Date(latestEvaluation.created_at).getTime() >= new Date(rule.updated_at).getTime()
    ) {
      rule.latest_evaluation = latestEvaluation
    }
    return rule
  })
  const rulesBySet = new Map<string, ContractRuleAsset[]>()
  for (const rule of rules) {
    if (!rule.rule_set_id) continue
    const current = rulesBySet.get(rule.rule_set_id) || []
    current.push(rule)
    rulesBySet.set(rule.rule_set_id, current)
  }

  const sets = (setRows || []).map((row) => ({
    ...row,
    priority: row.priority ?? 0,
    is_default: row.is_default ?? false,
    is_active: row.is_active ?? true,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    rules: rulesBySet.get(row.id) || [],
  })) as ContractRuleSetAsset[]

  const summary: ContractRuleAssetSummary = {
    sets: sets.length,
    rules: rules.length,
    published: rules.filter((rule) => rule.lifecycle_status === 'published' && rule.is_active).length,
  }

  return { sets, rules, summary, bundle }
}

export async function loadRuleAsset(orgId: string, ruleId: string) {
  const { data, error } = await supabaseAdmin
    .from('contract_rules_v2')
    .select('*')
    .eq('org_id', orgId)
    .eq('id', ruleId)
    .maybeSingle()

  if (error) throw error
  return data ? normalizeRule(data as Record<string, unknown>) : null
}
