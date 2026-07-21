import { supabaseAdmin } from '@/lib/supabase'
import { getOrgIdForUser } from '@/lib/configs/runtime'
import { executeRules } from '@/lib/rules/engine'
import {
  executeContractSemanticReview,
  type ContractSemanticReviewResult,
} from '@/lib/ai/contract-semantic'
import { AIExecutionError } from '@/lib/ai/runtime-executor'
import { logError } from '@/lib/error-log'
import { buildCommentPatchesFromRiskCards } from '@/lib/contracts/comment-patch'
import { getOrCompilePublishedContractSkillBundle, type ContractSkillBundle } from '@/lib/contracts/skill-bundle'
import type { RuleExecutionPropertyReading } from '@/lib/rules/types'
import type { ContractRuleContract } from '@/types/rules'

export interface ContractAnalysisJobRecord {
  id: string
  contract_id: string
  review_id: string
  requested_by: string | null
  status: 'queued' | 'running' | 'completed' | 'failed'
  attempts: number
  provider: string | null
  degraded: boolean
  last_error: string | null
  locked_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ContractAnalysisResult {
  risks: Array<{
    ruleId?: string
    ruleCode?: string
    ruleVersion?: number
    decisionId?: string
    propertyReadings?: RuleExecutionPropertyReading[]
    level: 'red' | 'yellow' | 'green'
    title: string
    description: string
    suggestion: string
    counterparty?: string
    evidence?: string[]
  }>
  summary: string
  appliedRules: number
  matchedRules: number
  provider: string
  degraded: boolean
  degradationReasons?: string[]
}

export interface ClauseMatch {
  clauseNumber: string | null
  clauseTitle: string | null
  clauseText: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  riskCategory: string | null
  riskDescription: string | null
  legalBasis: string | null
  suggestion: string | null
  suggestedText: string | null
  matchedLibraryClauseId: string | null
  position: number
  startOffset: number
  endOffset: number
}

export interface RiskSummary {
  total_clauses: number
  critical_risks: number
  high_risks: number
  medium_risks: number
  low_risks: number
  compliance_score: number
  strategy_code?: string
}

export interface ComplianceCheck {
  missing_required_clauses: string[]
  dangerous_clauses: string[]
  ambiguous_clauses: string[]
  unbalanced_clauses: string[]
  party_a_consistency: 'consistent' | 'inconsistent' | 'unknown'
  party_b_consistency: 'consistent' | 'inconsistent' | 'unknown'
  issues: string[]
}

export interface StructuredReport {
  result: ContractAnalysisResult
  risk_summary: RiskSummary
  compliance_check: ComplianceCheck
  effectiveness_analysis: string
  clauses: ClauseMatch[]
  runtime?: ReviewRuntimeBinding
  source_text?: string
}

export interface ReviewOptions {
  strategyCode?: 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE'
  reviewId?: string
  requestedBy?: string | null
  reviewTrigger?: string
  reviewEvent?: string
  /** Exact ModelCatalogEntry asset for controlled comparison runs only. */
  semanticModelAssetId?: string
  /** @deprecated legacy caller field; interpreted only as an exact model asset id. */
  semanticProviderProfile?: string
}

export interface ReviewRuntimeBinding {
  skill_bundle_id: string | null
  /** Legacy read-only pointer; new ReviewRuns bind plan_snapshot_id. */
  model_policy_id: string | null
  plan_snapshot_id: string | null
  plan_snapshot_hash?: string | null
  rule_snapshot_ids: string[]
  rule_set_snapshot_ids: string[]
  rule_set_document_ids: string[]
  rule_snapshot_refs?: Array<{
    id: string
    rule_id?: string | null
    code?: string | null
    version?: number | null
  }>
  model_invocation_ids: string[]
  provider: string
  model: string
  review_trigger?: string
}

export function formatAnalysisError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const parts = [record.message, record.details, record.hint, record.code]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
    if (parts.length > 0) return parts.join(' | ')
  }
  return String(error)
}

export async function enqueueContractAnalysisJob(contractId: string, reviewId: string, requestedBy: string) {
  const { data, error } = await supabaseAdmin
    .from('contract_analysis_jobs')
    .insert({
      contract_id: contractId,
      review_id: reviewId,
      requested_by: requestedBy,
      status: 'queued',
    })
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as ContractAnalysisJobRecord
}

export async function claimNextContractAnalysisJob(workerId: string) {
  const { data, error } = await supabaseAdmin
    .rpc('claim_contract_analysis_job', {
      p_worker_id: workerId,
    })

  if (error) {
    throw error
  }

  const job = Array.isArray(data) ? data[0] : data
  return (job ?? null) as ContractAnalysisJobRecord | null
}

export async function fetchContractText(contractId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('contracts')
    .select('parsed_text, filename')
    .eq('id', contractId)
    .single()

  if (error) {
    throw error
  }

  if (data?.parsed_text) {
    return data.parsed_text
  }

  return `合同文件: ${data?.filename || 'unknown'}`
}

async function fetchContractContext(contractId: string): Promise<{ text: string; orgId?: string }> {
  const { data, error } = await supabaseAdmin
    .from('contracts')
    .select('parsed_text, filename, created_by')
    .eq('id', contractId)
    .single()

  if (error) {
    throw error
  }

  const text = data?.parsed_text || `合同文件: ${data?.filename || 'unknown'}`
  const orgId = data?.created_by ? await getOrgIdForUser(data.created_by) || undefined : undefined

  return { text, orgId }
}

export async function runContractAnalysis(contractId: string): Promise<ContractAnalysisResult> {
  const context = await fetchContractContext(contractId)
  const ruleResult = await executeRules(context.text, context.orgId)

  return {
    risks: ruleResult.risks,
    summary: ruleResult.summary,
    appliedRules: ruleResult.appliedRules,
    matchedRules: ruleResult.matchedRules,
    provider: 'rule-engine',
    degraded: ruleResult.appliedRules === 0,
  }
}

export async function markContractAnalysisRunning(job: ContractAnalysisJobRecord) {
  const now = new Date().toISOString()
  const nextAttempts = job.status === 'running' ? job.attempts : job.attempts + 1
  const nextProvider = job.status === 'running'
    ? job.provider
    : (job.provider ?? 'inline-request')

  await Promise.all([
    supabaseAdmin
      .from('contracts')
      .update({
        status: 'ANALYZING',
        updated_at: now,
      })
      .eq('id', job.contract_id),
    supabaseAdmin
      .from('contract_reviews')
      .update({
        status: 'ANALYZING',
      })
      .eq('id', job.review_id),
    supabaseAdmin
      .from('contract_analysis_jobs')
      .update({
        status: 'running',
        attempts: nextAttempts,
        provider: nextProvider,
        last_error: null,
        locked_at: now,
        started_at: job.started_at ?? now,
        updated_at: now,
      })
      .eq('id', job.id),
  ])
}

export async function markContractAnalysisCompleted(job: ContractAnalysisJobRecord, result: ContractAnalysisResult) {
  const now = new Date().toISOString()
  const reviewStatus = result.degraded ? 'DEGRADED' : 'COMPLETED'

  await Promise.all([
    supabaseAdmin
      .from('contracts')
      .update({
        status: 'COMPLETED',
        updated_at: now,
      })
      .eq('id', job.contract_id),
    supabaseAdmin
      .from('contract_reviews')
      .update({
        status: reviewStatus,
        results: result,
        completed_at: now,
      })
      .eq('id', job.review_id),
    supabaseAdmin
      .from('contract_analysis_jobs')
      .update({
        status: 'completed',
        provider: result.provider,
        degraded: result.degraded,
        completed_at: now,
        locked_at: null,
        updated_at: now,
      })
      .eq('id', job.id),
  ])
}

export async function markContractAnalysisFailed(job: ContractAnalysisJobRecord, error: unknown) {
  const now = new Date().toISOString()
  const message = formatAnalysisError(error)

  await Promise.all([
    supabaseAdmin
      .from('contracts')
      .update({
        status: 'FAILED',
        updated_at: now,
      })
      .eq('id', job.contract_id),
    supabaseAdmin
      .from('contract_reviews')
      .update({
        status: 'FAILED',
        results: { error: message },
        completed_at: now,
      })
      .eq('id', job.review_id),
    supabaseAdmin
      .from('contract_analysis_jobs')
      .update({
        status: 'failed',
        last_error: message,
        locked_at: null,
        completed_at: now,
        updated_at: now,
      })
      .eq('id', job.id),
  ])
}

export async function processQueuedContractAnalysisJobs(workerId: string, limit: number = 1) {
  const processed: Array<{
    jobId: string
    contractId: string
    reviewId: string
    status: 'completed' | 'failed'
    provider?: string
    degraded?: boolean
    error?: string
  }> = []

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextContractAnalysisJob(workerId)
    if (!job) {
      break
    }

    try {
      const outcome = await processContractAnalysisJob(job)

      processed.push({
        jobId: job.id,
        contractId: job.contract_id,
        reviewId: job.review_id,
        status: 'completed',
        provider: outcome.provider,
        degraded: outcome.degraded,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      processed.push({
        jobId: job.id,
        contractId: job.contract_id,
        reviewId: job.review_id,
        status: 'failed',
        error: message,
      })
    }
  }

  return processed
}

export async function processContractAnalysisJob(job: ContractAnalysisJobRecord) {
  try {
    await markContractAnalysisRunning(job)
    const structuredReport = await runStructuredAnalysis(job.contract_id, {
      reviewId: job.review_id,
      requestedBy: job.requested_by,
      reviewTrigger: 'worker',
    })
    await saveStructuredReport(job.review_id, job.contract_id, structuredReport)
    await markContractAnalysisCompleted(job, structuredReport.result)
    return structuredReport.result
  } catch (error) {
    await markContractAnalysisFailed(job, error)
    throw error
  }
}

// ============ 结构化报告生成（iTerms 风格）============

export interface StructuredReport {
  result: ContractAnalysisResult
  risk_summary: RiskSummary
  compliance_check: ComplianceCheck
  effectiveness_analysis: string
  clauses: ClauseMatch[]
}

function extractClauses(text: string): ClauseMatch[] {
  const clauses: ClauseMatch[] = []
  if (!text) return clauses

  const patterns = [
    /(?:^|\n)\s*第\s*([一二三四五六七八九十百零0-9]+)\s*[条章节款项][\s、：:]*(.{0,80}?)(?=\n|$)/g,
    /(?:^|\n)\s*(\d+\.\d+(?:\.\d+)?)\s*[、.]?\s*(.{0,80}?)(?=\n|$)/g,
  ]

  let position = 0
  const seen = new Set<string>()

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      const clauseNumber = match[1]?.trim() || null
      const clauseTitle = match[2]?.trim() || null
      const startOffset = match.index
      const endOffset = match.index + match[0].length
      const clauseText = match[0].trim()
      const key = `${clauseNumber}-${clauseText.slice(0, 30)}`
      if (seen.has(key) || clauseText.length < 5) continue
      seen.add(key)

      clauses.push({
        clauseNumber, clauseTitle, clauseText,
        riskLevel: 'low', riskCategory: null, riskDescription: null,
        legalBasis: null, suggestion: null, suggestedText: null,
        matchedLibraryClauseId: null, position: position++,
        startOffset, endOffset,
      })
      if (clauses.length >= 50) break
    }
    if (clauses.length >= 50) break
  }

  if (clauses.length === 0) {
    const blocks = text
      .split(/[\n。；;]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 12)
      .slice(0, 50)

    let cursor = 0
    blocks.forEach((block, index) => {
      const startOffset = text.indexOf(block, cursor)
      const safeStart = startOffset >= 0 ? startOffset : cursor
      const endOffset = safeStart + block.length
      cursor = endOffset
      clauses.push({
        clauseNumber: String(index + 1),
        clauseTitle: guessClauseTitle(block),
        clauseText: block,
        riskLevel: 'low',
        riskCategory: null,
        riskDescription: null,
        legalBasis: null,
        suggestion: null,
        suggestedText: null,
        matchedLibraryClauseId: null,
        position: index,
        startOffset: safeStart,
        endOffset,
      })
    })
  }

  return clauses
}

function guessClauseTitle(text: string): string {
  if (/(付款|支付|价款|账期|首付|预付款)/.test(text)) return '付款条款'
  if (/(交付|验收|交货|实施)/.test(text)) return '交付验收'
  if (/(违约|赔偿|滞纳金)/.test(text)) return '违约责任'
  if (/(保密|商业秘密)/.test(text)) return '保密条款'
  if (/(知识产权|著作权|专利|源代码)/.test(text)) return '知识产权'
  if (/(争议|仲裁|法院|管辖)/.test(text)) return '争议解决'
  if (/(终止|解除|续约)/.test(text)) return '终止续约'
  return text.slice(0, 24)
}

function applyRiskFactsToClauses(
  clauses: ClauseMatch[],
  risks: ContractAnalysisResult['risks'],
  sourceText?: string
): void {
  const riskLevelMap: Record<'red' | 'yellow' | 'green', ClauseMatch['riskLevel']> = {
    red: 'critical',
    yellow: 'high',
    green: 'low',
  }

  for (const risk of risks) {
    if (risk.level === 'green') continue

    const location = locateRiskSource(risk, clauses, sourceText)
    const clause = location.clause
    if (!clause) continue

    clause.riskLevel = riskLevelMap[risk.level]
    clause.riskCategory = risk.ruleCode || null
    clause.riskDescription = risk.description
    clause.suggestion = risk.suggestion
  }
}

async function matchClauseLibrary(clauses: ClauseMatch[], orgId?: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let query = supabaseAdmin.from('clause_library')
    .select('id, category, stance, template_text, org_id')
  query = orgId ? query.or(`org_id.is.null,org_id.eq.${orgId}`) : query.is('org_id', null)
  const { data: library, error } = await query
  if (error || !library) return map

  const keywordsMap: Record<string, string[]> = {
    payment: ['付款', '支付', '价款', '费用', '预付', '结算', '对价'],
    delivery: ['交付', '运送', '发货', '运输', '移交', '验收'],
    quality: ['质量', '保修', '质保', '售后', '维修', '缺陷'],
    breach: ['违约', '违约金', '赔偿', '罚则', '损失'],
    dispute: ['争议', '仲裁', '诉讼', '管辖', '法院', '争议解决'],
    liability: ['免责', '责任', '不可抗力', '赔偿'],
    ip: ['知识产权', '专利', '著作权', '技术成果'],
  }
  for (const clause of clauses) {
    const text = `${clause.clauseTitle || ''} ${clause.clauseText}`
    for (const [category, kws] of Object.entries(keywordsMap)) {
      if (kws.some(kw => text.includes(kw))) {
        const matched = library.find(lib =>
          lib.category === category && (lib.stance === 'required' || lib.stance === 'dangerous' || lib.stance === 'risky')
        )
        if (matched) map.set(clause.clauseText.slice(0, 50), matched.id)
        break
      }
    }
  }
  return map
}

function calculateRiskSummary(risks: ContractAnalysisResult['risks'], clauseCount: number, strategyCode?: string): RiskSummary {
  let critical = 0
  let high = 0
  const medium = 0
  let low = 0
  for (const risk of risks) {
    if (risk.level === 'red') critical++
    else if (risk.level === 'yellow') high++
    else low++
  }
  const score = Math.max(0, Math.min(100, 100 - critical * 25 - high * 10 - medium * 3))
  return {
    total_clauses: clauseCount,
    critical_risks: critical,
    high_risks: high,
    medium_risks: medium,
    low_risks: low,
    compliance_score: score,
    strategy_code: strategyCode,
  }
}
async function performComplianceCheck(
  clauses: ClauseMatch[],
  orgId: string | undefined
): Promise<ComplianceCheck> {
  const result: ComplianceCheck = {
    missing_required_clauses: [],
    dangerous_clauses: [],
    ambiguous_clauses: [],
    unbalanced_clauses: [],
    party_a_consistency: 'unknown',
    party_b_consistency: 'unknown',
    issues: [],
  }

  // 1. 必备条款检查
  let required: Array<{ category: string; name: string }> = []
  try {
    let q = supabaseAdmin.from('clause_library').select('name, category, stance').eq('stance', 'required')
    q = orgId ? q.or(`org_id.is.null,org_id.eq.${orgId}`) : q.is('org_id', null)
    const { data } = await q
    required = (data || []).map(d => ({ category: d.category, name: d.name }))
  } catch (error) {
    await logError({
      level: 'warn',
      source: 'worker',
      message: '加载必备条款库失败',
      error,
      context: { phase: 'required_clause_check', orgId },
    })
  }

  const found = new Set<string>()
  const kwsMap: Record<string, string[]> = {
    payment: ['付款', '支付', '价款'],
    delivery: ['交付', '运送'],
    quality: ['质量', '保修'],
    breach: ['违约', '违约金'],
    dispute: ['争议', '仲裁'],
  }
  for (const clause of clauses) {
    const text = clause.clauseText
    for (const [cat, kws] of Object.entries(kwsMap)) {
      if (kws.some(kw => text.includes(kw))) {
        found.add(cat)
        break
      }
    }
  }
  for (const req of required) {
    if (!found.has(req.category)) {
      result.missing_required_clauses.push(req.name)
    }
  }

  // 2. 危险条款检查
  try {
    let q = supabaseAdmin.from('clause_library').select('id, name, template_text, stance')
      .in('stance', ['dangerous', 'risky'])
    q = orgId ? q.or(`org_id.is.null,org_id.eq.${orgId}`) : q.is('org_id', null)
    const { data: dangerous } = await q
    if (dangerous) {
      for (const dc of dangerous) {
        for (const clause of clauses) {
          if (dc.template_text && clause.clauseText.includes(dc.template_text.slice(0, 30))) {
            if (dc.stance === 'dangerous') result.dangerous_clauses.push(dc.name)
            break
          }
        }
      }
    }
  } catch (error) {
    await logError({
      level: 'warn',
      source: 'worker',
      message: '加载风险条款库失败',
      error,
      context: { phase: 'dangerous_clause_check', orgId },
    })
  }

  // 3. 模糊用语检查
  for (const clause of clauses) {
    if (/(?:等|之类|有关|相关|类似|适当|合理)/.test(clause.clauseText) && clause.clauseText.length < 100) {
      result.ambiguous_clauses.push(
        `${clause.clauseNumber || '?'}条：包含模糊用语`
      )
    }
  }

  return result
}

function generateEffectivenessAnalysis(c: ComplianceCheck, r: RiskSummary): string {
  const lines: string[] = []
  lines.push(`## 合同效力与风险分析报告`)
  lines.push(``)
  lines.push(`### 综合评分：${r.compliance_score}/100`)
  if (r.compliance_score >= 80) lines.push(`合同条款较为完整，风险整体可控。`)
  else if (r.compliance_score >= 60) lines.push(`合同存在部分风险条款，建议重点关注并修改。`)
  else lines.push(`合同存在重大风险，不建议直接签署。`)
  lines.push(``)

  if (c.missing_required_clauses.length > 0) {
    lines.push(`### 缺失必备条款（${c.missing_required_clauses.length}项）`)
    for (const x of c.missing_required_clauses) lines.push(`- ${x}`)
    lines.push(``)
  }
  if (c.dangerous_clauses.length > 0) {
    lines.push(`### 高风险条款（${c.dangerous_clauses.length}项）`)
    for (const x of c.dangerous_clauses) lines.push(`- ${x}`)
    lines.push(``)
  }
  if (c.ambiguous_clauses.length > 0) {
    lines.push(`### 模糊用语条款（${c.ambiguous_clauses.length}项）`)
    for (const x of c.ambiguous_clauses.slice(0, 5)) lines.push(`- ${x}`)
    lines.push(``)
  }
  if (c.issues.length > 0) {
    lines.push(`### 其他问题`)
    for (const x of c.issues) lines.push(`- ${x}`)
    lines.push(``)
  }
  return lines.join('\n')
}

type AnalysisRisk = ContractAnalysisResult['risks'][number]

type RiskSourceLocation = {
  snippet: string | null
  clause: ClauseMatch | null
  startOffset: number | null
  endOffset: number | null
  status: 'located' | 'manual_required'
  reason: string
}

function isGenericEvidenceSnippet(snippet: string) {
  const normalized = snippet.trim()
  if (normalized.length < 2) return true
  return ['ONES', '书面', '合同', '有效期', '6%', '0'].includes(normalized)
}

function evidenceCandidates(risk: AnalysisRisk) {
  return (risk.evidence || [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !isGenericEvidenceSnippet(item))
}

function findClauseForOffset(clauses: ClauseMatch[], startOffset: number, endOffset: number): ClauseMatch | null {
  return clauses.find((clause) => (
    startOffset >= clause.startOffset && startOffset <= clause.endOffset
  )) || clauses.find((clause) => (
    endOffset >= clause.startOffset && startOffset <= clause.endOffset
  )) || null
}

function locateRiskSource(
  risk: AnalysisRisk,
  clauses: ClauseMatch[],
  sourceText?: string
): RiskSourceLocation {
  for (const snippet of evidenceCandidates(risk)) {
    if (sourceText) {
      const sourceIndex = sourceText.indexOf(snippet)
      if (sourceIndex >= 0) {
        const endOffset = sourceIndex + snippet.length
        return {
          snippet,
          clause: findClauseForOffset(clauses, sourceIndex, endOffset),
          startOffset: sourceIndex,
          endOffset,
          status: 'located',
          reason: 'evidence_text_exact_match',
        }
      }
    }

    for (const clause of clauses) {
      const localIndex = clause.clauseText.indexOf(snippet)
      if (localIndex >= 0) {
        const startOffset = clause.startOffset + localIndex
        return {
          snippet,
          clause,
          startOffset,
          endOffset: startOffset + snippet.length,
          status: 'located',
          reason: 'evidence_text_exact_match',
        }
      }
    }
  }

  return {
    snippet: evidenceCandidates(risk)[0] || null,
    clause: null,
    startOffset: null,
    endOffset: null,
    status: 'manual_required',
    reason: risk.evidence?.length ? 'evidence_text_not_found_in_clauses' : 'missing_evidence_text',
  }
}

function runtimeRuleSnapshotRef(
  runtime: ReviewRuntimeBinding | undefined,
  risk: AnalysisRisk
) {
  const refs = runtime?.rule_snapshot_refs || []
  return refs.find((ref) => (
    (risk.ruleId && ref.rule_id === risk.ruleId)
    || (risk.ruleCode && ref.code === risk.ruleCode)
  )) || null
}

function extractRuntimeSnapshotRefs(skillBundle: ContractSkillBundle) {
  const compiledFrom = skillBundle.compiled_from || {}
  const rules = Array.isArray(compiledFrom.rule_units)
    ? compiledFrom.rule_units
    : Array.isArray(compiledFrom.rules)
      ? compiledFrom.rules
      : []
  return rules
    .map((rule) => {
      if (!rule || typeof rule !== 'object') return null
      const record = rule as Record<string, unknown>
      return {
        id: typeof record.id === 'string' ? record.id : '',
        rule_id: typeof record.rule_id === 'string' ? record.rule_id : null,
        code: typeof record.code === 'string' ? record.code : null,
        version: typeof record.version === 'number' ? record.version : null,
        category: typeof record.clause_category === 'string' ? record.clause_category : null,
        targetField: typeof record.target_field === 'string' ? record.target_field : null,
        fieldHints: Array.isArray(record.field_hints)
          ? record.field_hints.filter((hint): hint is string => typeof hint === 'string')
          : [],
        executionProtocol: record.execution_protocol === 'rule_contract_v1'
          ? 'rule_contract_v1' as const
          : 'legacy_adapter' as const,
        ruleContract: record.rule_contract && typeof record.rule_contract === 'object'
          ? record.rule_contract as ContractRuleContract
          : null,
      }
    })
    .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref?.id))
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function skillBundleEvalStatus(skillBundle: ContractSkillBundle | null): string | null {
  if (!skillBundle) return null
  const evalResults = recordValue(recordValue(skillBundle.compiled_from).eval_results)
  return stringValue(evalResults.rule_acceptance_status)
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function skillBundleFormalReadinessReasons(skillBundle: ContractSkillBundle | null): string[] {
  if (!skillBundle) return ['skill_not_applied']

  const reasons: string[] = []
  if (skillBundle.status !== 'published') {
    reasons.push('skill_bundle_not_published')
  }
  if (!skillBundle.is_current) {
    reasons.push('skill_bundle_not_current')
  }

  const compiledFrom = recordValue(skillBundle.compiled_from)
  const gate = recordValue(compiledFrom.rule_translation_gate)
  const ruleTranslationStatus = stringValue(gate.status)
  const officialReviewAllowed = booleanValue(gate.official_review_allowed)
  if (!ruleTranslationStatus) {
    reasons.push('rule_translation_gate_missing')
  } else if (ruleTranslationStatus !== 'ready' || officialReviewAllowed === false) {
    reasons.push('rule_translation_not_ready')
  }

  const ruleSetDocumentGate = recordValue(compiledFrom.rule_set_document_gate)
  const ruleSetDocumentStatus = stringValue(ruleSetDocumentGate.status)
  if (!ruleSetDocumentStatus) {
    reasons.push('ruleset_document_gate_missing')
  } else if (ruleSetDocumentStatus !== 'ready') {
    reasons.push('ruleset_document_not_ready')
  }

  const evalStatus = skillBundleEvalStatus(skillBundle)
  if (!evalStatus) {
    reasons.push('skill_eval_missing')
  } else if (evalStatus === 'runtime_eval_not_run') {
    reasons.push('skill_eval_not_run')
  } else if (evalStatus !== 'passed') {
    reasons.push('skill_eval_not_passed')
  }

  return Array.from(new Set(reasons))
}

function skillContextSource(skillBundle: ContractSkillBundle) {
  const compiledFrom = recordValue(skillBundle.compiled_from)
  const referenceAssets = Array.isArray(compiledFrom.reference_assets)
    ? compiledFrom.reference_assets
    : []
  return {
    source_of_truth: 'config_center_published_rules',
    production_rule_source: recordValue(compiledFrom.production_rule_source),
    reference_assets: referenceAssets,
  }
}

function normalizeRiskText(value: string | undefined): string {
  return (value || '')
    .replace(/\s+/g, '')
    .replace(/[，。；：、,.!?！？;:]/g, '')
    .toLowerCase()
    .slice(0, 120)
}

function normalizeRuleCode(value: string | undefined) {
  return (value || '').trim().toUpperCase().replace(/@V\d+$/, '')
}

function riskFingerprint(risk: AnalysisRisk): string {
  const normalizedRuleCode = normalizeRuleCode(risk.ruleCode)
  if (normalizedRuleCode) return `rule:${normalizedRuleCode}`
  return [
    normalizeRiskText(risk.title),
    normalizeRiskText(risk.description),
  ].filter(Boolean).join('|')
}

function riskMergeScore(risk: AnalysisRisk) {
  const severityScore = risk.level === 'red' ? 30 : risk.level === 'yellow' ? 20 : 10
  const evidenceScore = evidenceCandidates(risk).length > 0 ? 2 : 0
  const versionedCodeScore = risk.ruleCode?.includes('@v') ? 1 : 0
  return severityScore + evidenceScore + versionedCodeScore
}

function shouldReplaceRisk(existing: AnalysisRisk, candidate: AnalysisRisk) {
  return riskMergeScore(candidate) > riskMergeScore(existing)
}

function mergeReviewRisks(
  ruleRisks: AnalysisRisk[],
  semanticRisks: AnalysisRisk[]
): { risks: AnalysisRisk[]; added: number } {
  const slots: Array<{ key: string | null; risk: AnalysisRisk }> = []

  const addRisk = (risk: AnalysisRisk) => {
    const key = riskFingerprint(risk)
    if (!key) {
      slots.push({ key: null, risk })
      return true
    }

    const existingIndex = slots.findIndex((slot) => slot.key === key)
    if (existingIndex < 0) {
      slots.push({ key, risk })
      return true
    }

    if (shouldReplaceRisk(slots[existingIndex].risk, risk)) {
      slots[existingIndex] = { key, risk }
      return true
    }

    return false
  }

  for (const risk of ruleRisks) addRisk(risk)

  let added = 0
  for (const risk of semanticRisks) {
    if (addRisk(risk)) added += 1
  }

  return { risks: slots.map((slot) => slot.risk), added }
}

function buildCombinedSummary(ruleSummary: string, semanticResult: ContractSemanticReviewResult | null): string {
  if (!semanticResult) return ruleSummary
  return `${ruleSummary}\n\n语义审核（${semanticResult.provider}/${semanticResult.model}）：${semanticResult.summary}`
}

function buildDegradationReasons(input: {
  skillBundle: ContractSkillBundle | null
  structuredDegraded: boolean
  unlocatedCommentableRiskCount?: number
  semanticResult?: ContractSemanticReviewResult | null
  semanticError?: string | null
  skillBundleLoadError?: string | null
}) {
  const reasons: string[] = []
  reasons.push(...skillBundleFormalReadinessReasons(input.skillBundle))
  if (input.skillBundleLoadError) reasons.push('skill_bundle_load_failed')
  if (input.structuredDegraded) {
    reasons.push('rule_engine_no_rules_applied')
  }
  if (input.unlocatedCommentableRiskCount && input.unlocatedCommentableRiskCount > 0) {
    reasons.push('source_location_unbound')
  }
  if (input.semanticResult?.degraded) reasons.push('semantic_review_route_fallback')
  if (input.semanticError) reasons.push('semantic_review_failed')
  if (
    (input.semanticResult?.validationWarnings?.length || 0) > 0
    || (input.semanticResult?.droppedRiskCount || 0) > 0
  ) {
    reasons.push('semantic_review_output_validation_partial')
  }
  if (input.semanticResult?.inputStats?.coverage_limited) {
    reasons.push('semantic_review_input_coverage_limited')
  }
  return Array.from(new Set(reasons))
}

function countUnlocatedCommentableRisks(risks: AnalysisRisk[], clauses: ClauseMatch[], sourceText?: string) {
  return risks.filter((risk) => {
    if (risk.level !== 'red' && risk.level !== 'yellow') return false
    return locateRiskSource(risk, clauses, sourceText).status !== 'located'
  }).length
}

async function runSemanticReviewStage(input: {
  text: string
  orgId: string
  skillBundle: ContractSkillBundle | null
  contractId: string
  reviewId?: string
  reviewTrigger?: string
  reviewEvent?: string
  semanticModelAssetId?: string
}): Promise<{
  result: ContractSemanticReviewResult | null
  invocationIds: string[]
  planSnapshotId: string | null
  planSnapshotHash: string | null
  error: string | null
  addedRiskCount: number
  risks: AnalysisRisk[]
}> {
  try {
    const skillRules = (input.skillBundle ? extractRuntimeSnapshotRefs(input.skillBundle) : []).map((ref) => ({
      code: ref.code,
      version: ref.version,
      clause_category: ref.category,
      target_field: ref.targetField,
      field_hints: ref.fieldHints,
      execution_protocol: ref.executionProtocol,
      rule_contract: ref.ruleContract,
    }))
    const semanticResult = await executeContractSemanticReview({
      orgId: input.orgId,
      contractId: input.contractId,
      reviewId: input.reviewId,
      skillBundleId: input.skillBundle?.id || null,
      contractText: input.text,
      executionEnvironment: process.env.VERCEL === '1' && Boolean(process.env.VERCEL_URL || process.env.VERCEL_REGION)
        ? 'hosted'
        : 'local',
      pinModelAssetId: input.semanticModelAssetId,
      reviewTrigger: input.reviewTrigger,
      reviewEvent: input.reviewEvent,
      skillContext: {
        source: input.skillBundle ? skillContextSource(input.skillBundle) : {
          source_of_truth: 'no_valid_published_rule_bundle',
        },
        compiledFrom: input.skillBundle?.compiled_from,
        outputSchema: input.skillBundle?.output_schema,
        rules: skillRules,
      },
    })
    const usableRisks = semanticResult.risks

    return {
      result: semanticResult,
      invocationIds: semanticResult.invocationIds,
      planSnapshotId: semanticResult.planSnapshotId,
      planSnapshotHash: semanticResult.planSnapshotHash,
      error: null,
      addedRiskCount: usableRisks.length,
      risks: usableRisks,
    }
  } catch (error) {
    return {
      result: null,
      invocationIds: error instanceof AIExecutionError
        ? error.attempts.map((attempt) => attempt.id)
        : [],
      planSnapshotId: error instanceof AIExecutionError ? error.planSnapshotId : null,
      planSnapshotHash: null,
      error: formatAnalysisError(error),
      addedRiskCount: 0,
      risks: [],
    }
  }
}

export async function runStructuredAnalysis(
  contractId: string,
  options?: ReviewOptions
): Promise<StructuredReport> {
  const context = await fetchContractContext(contractId)
  let skillBundle: ContractSkillBundle | null = null
  let skillBundleLoadError: string | null = null
  if (context.orgId) {
    try {
      skillBundle = await getOrCompilePublishedContractSkillBundle({
        orgId: context.orgId,
        requestedBy: options?.requestedBy,
      })
    } catch (error) {
      // A broken rule asset is a rule-release failure, not permission to hide
      // the platform model use point. Continue with an empty rule context and
      // keep the official review degraded and auditable.
      skillBundleLoadError = formatAnalysisError(error)
    }
  }

  const ruleSnapshotIds = skillBundle?.rule_snapshot_ids || []
  const ruleResult = await executeRules(context.text, context.orgId, {
    ruleSnapshotIds,
  })

  let semanticStage: Awaited<ReturnType<typeof runSemanticReviewStage>> | null = null
  // Platform model execution and rule-release eligibility are independent
  // dimensions. An incomplete rule bundle still degrades the official review,
  // but must not silently prevent the configured AI use point from running.
  if (context.orgId) {
    semanticStage = await runSemanticReviewStage({
      text: context.text,
      orgId: context.orgId,
      skillBundle,
      contractId,
      reviewId: options?.reviewId,
      reviewTrigger: options?.reviewTrigger,
      reviewEvent: options?.reviewEvent,
      semanticModelAssetId: options?.semanticModelAssetId || options?.semanticProviderProfile,
    })
  }

  const merged = mergeReviewRisks(ruleResult.risks, semanticStage?.risks || [])
  const clauses = extractClauses(context.text)
  const unlocatedCommentableRiskCount = countUnlocatedCommentableRisks(merged.risks, clauses, context.text)
  const structuredDegraded = ruleResult.appliedRules === 0
  const degradationReasons = buildDegradationReasons({
    skillBundle,
    structuredDegraded,
    unlocatedCommentableRiskCount,
    semanticResult: semanticStage?.result || null,
    semanticError: semanticStage?.error || null,
    skillBundleLoadError,
  })
  const result: ContractAnalysisResult = {
    risks: merged.risks,
    summary: buildCombinedSummary(ruleResult.summary, semanticStage?.result || null),
    appliedRules: ruleResult.appliedRules,
    matchedRules: ruleResult.matchedRules,
    provider: semanticStage?.result
      ? `rule-engine+${semanticStage.result.provider}`
      : 'rule-engine',
    degraded: degradationReasons.length > 0,
    degradationReasons,
  }

  let runtime: ReviewRuntimeBinding | undefined
  if (context.orgId) {
    runtime = {
      skill_bundle_id: skillBundle?.id || null,
      model_policy_id: null,
      plan_snapshot_id: semanticStage?.planSnapshotId || null,
      plan_snapshot_hash: semanticStage?.planSnapshotHash || null,
      rule_snapshot_ids: skillBundle?.rule_snapshot_ids || [],
      rule_set_snapshot_ids: skillBundle?.rule_set_snapshot_ids || [],
      rule_set_document_ids: skillBundle?.document_snapshot_ids || [],
      rule_snapshot_refs: skillBundle ? extractRuntimeSnapshotRefs(skillBundle) : [],
      // Deterministic rule execution is evidenced by frozen rule snapshots,
      // not fabricated as a model invocation.
      model_invocation_ids: semanticStage?.invocationIds || [],
      provider: result.provider,
      model: semanticStage?.result
        ? semanticStage.result.model
        : 'not-invoked',
      review_trigger: options?.reviewTrigger,
    }
  }

  applyRiskFactsToClauses(clauses, result.risks, context.text)
  const clauseMatches = await matchClauseLibrary(clauses, context.orgId)
  for (const clause of clauses) {
    const libId = clauseMatches.get(clause.clauseText.slice(0, 50))
    if (libId) clause.matchedLibraryClauseId = libId
  }

  const risk_summary = calculateRiskSummary(result.risks, clauses.length, options?.strategyCode)
  const compliance_check = await performComplianceCheck(clauses, context.orgId)
  const effectiveness_analysis = generateEffectivenessAnalysis(compliance_check, risk_summary)

  return { result, risk_summary, compliance_check, effectiveness_analysis, clauses, runtime, source_text: context.text }
}

export async function saveStructuredReport(
  reviewId: string,
  contractId: string,
  report: StructuredReport,
  strategyId?: string
): Promise<void> {
  await supabaseAdmin.from('contract_clauses').delete().eq('review_id', reviewId)
  await supabaseAdmin.from('contract_risk_cards').delete().eq('review_id', reviewId)
  await supabaseAdmin
    .from('contract_annotations')
    .delete()
    .eq('contract_id', contractId)
    .eq('category', 'risk_finding')

  if (report.result.risks.length > 0) {
    const riskRows = report.result.risks.map((risk) => {
      const sourceLocation = locateRiskSource(risk, report.clauses, report.source_text)
      const snapshotRef = runtimeRuleSnapshotRef(report.runtime, risk)

      return {
      review_id: reviewId,
      contract_id: contractId,
      // Canonical model output identifies the published rule by its frozen
      // code/version. The model must not be asked to invent internal UUIDs;
      // recover the source rule id from the already-bound immutable snapshot.
      rule_id: risk.ruleId || snapshotRef?.rule_id || null,
      rule_code: risk.ruleCode || null,
      rule_version: risk.ruleVersion || null,
      level: risk.level,
      title: risk.title,
      description: risk.description,
      suggestion: risk.suggestion,
      auto_fixable: false,
      detected_by: risk.ruleCode ? 'rule' : 'ai',
      confidence: report.result.degraded ? 0.5 : 0.8,
      evidence: {
        snippets: sourceLocation.snippet ? [sourceLocation.snippet] : [],
        counterparty: risk.counterparty || null,
        source_range: sourceLocation.status === 'located'
          ? { start: sourceLocation.startOffset, end: sourceLocation.endOffset }
          : null,
        location_status: sourceLocation.status,
        location_reason: sourceLocation.reason,
        rule_snapshot_id: snapshotRef?.id || null,
        rule_code: risk.ruleCode || null,
        rule_version: risk.ruleVersion || null,
        decision_id: risk.decisionId || null,
        property_readings: risk.propertyReadings || [],
      },
      status: 'open',
      clause_ref: sourceLocation.clause?.clauseNumber || sourceLocation.clause?.clauseTitle || null,
      position_start: sourceLocation.startOffset,
      position_end: sourceLocation.endOffset,
    }
    })
    const { data: insertedRisks, error: riskError } = await supabaseAdmin
      .from('contract_risk_cards')
      .insert(riskRows)
      .select('id, rule_id, rule_code, rule_version, title, description, suggestion, level, evidence, status, position_start, position_end')
    if (riskError) throw riskError

    const annotationRows = buildCommentPatchesFromRiskCards({
      contractId,
      risks: insertedRisks || [],
      sourceText: report.source_text,
    }).map((patch) => patch.annotation)

    if (annotationRows.length > 0) {
      const { error: annotationError } = await supabaseAdmin
        .from('contract_annotations')
        .insert(annotationRows)
      if (annotationError) throw annotationError
    }
  }

  if (report.clauses.length > 0) {
    const clauseRows = report.clauses.map(c => ({
      review_id: reviewId,
      contract_id: contractId,
      clause_number: c.clauseNumber,
      clause_title: c.clauseTitle,
      clause_text: c.clauseText,
      risk_level: c.riskLevel,
      risk_category: c.riskCategory,
      risk_description: c.riskDescription,
      legal_basis: c.legalBasis,
      suggestion: c.suggestion,
      suggested_text: c.suggestedText,
      matched_library_clause_id: c.matchedLibraryClauseId,
      position: c.position,
      start_offset: c.startOffset,
      end_offset: c.endOffset,
    }))
    const { error: clauseError } = await supabaseAdmin.from('contract_clauses').insert(clauseRows)
    if (clauseError) throw clauseError
  }

  const { error: reviewError } = await supabaseAdmin.from('contract_reviews').update({
    strategy_id: strategyId || null,
    risk_summary: report.risk_summary as unknown as Record<string, unknown>,
    compliance_check: report.compliance_check as unknown as Record<string, unknown>,
    effectiveness_analysis: report.effectiveness_analysis,
    report_version: 2,
    skill_bundle_id: report.runtime?.skill_bundle_id || null,
    model_policy_id: report.runtime?.model_policy_id || null,
    plan_snapshot_id: report.runtime?.plan_snapshot_id || null,
    rule_snapshot_ids: report.runtime?.rule_snapshot_ids || [],
    rule_set_snapshot_ids: report.runtime?.rule_set_snapshot_ids || [],
    rule_set_document_ids: report.runtime?.rule_set_document_ids || [],
    model_invocation_ids: report.runtime?.model_invocation_ids || [],
    review_trigger: report.runtime?.review_trigger || null,
  }).eq('id', reviewId)
  if (reviewError) throw reviewError
}
