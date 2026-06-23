import { supabaseAdmin } from '@/lib/supabase'
import { reviewWithFailoverSync } from '@/lib/ai/failover'
import { getOrgIdForUser } from '@/lib/configs/runtime'

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
    level: 'red' | 'yellow' | 'green'
    title: string
    description: string
    suggestion: string
  }>
  summary: string
  appliedRules: number
  matchedRules: number
  provider: string
  degraded: boolean
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
}

export interface ReviewOptions {
  strategyCode?: 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE'
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

/**
 * 运行合同分析 — 统一走AI降级链路
 * 后台任务和前端请求共用同一套降级逻辑，只是消费方式不同
 * 前端用 reviewWithFailover（流式），后台用 reviewWithFailoverSync（非流式）
 */
export async function runContractAnalysis(contractId: string): Promise<ContractAnalysisResult> {
  const context = await fetchContractContext(contractId)

  // 统一走AI降级链路（本地→云端→规则引擎→人工标记）
  const aiResult = await reviewWithFailoverSync(context.text, { orgId: context.orgId })

  return {
    risks: aiResult.risks,
    summary: aiResult.summary,
    appliedRules: aiResult.risks.length,
    matchedRules: aiResult.risks.filter((r) => r.level === 'red' || r.level === 'yellow').length,
    provider: aiResult.provider,
    degraded: aiResult.degraded,
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
        status: 'COMPLETED',
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
  const message = error instanceof Error ? error.message : String(error)

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
    const result = await runContractAnalysis(job.contract_id)
    await markContractAnalysisCompleted(job, result)
    return result
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
  return clauses
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
  } catch {
 /* ignore */ }

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
  } catch {
 /* ignore */ }

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

export async function runStructuredAnalysis(
  contractId: string,
  options?: ReviewOptions
): Promise<StructuredReport> {
  const context = await fetchContractContext(contractId)
  const aiResult = await reviewWithFailoverSync(context.text, { orgId: context.orgId })

  const result: ContractAnalysisResult = {
    risks: aiResult.risks,
    summary: aiResult.summary,
    appliedRules: aiResult.risks.length,
    matchedRules: aiResult.risks.filter((r) => r.level === 'red' || r.level === 'yellow').length,
    provider: aiResult.provider,
    degraded: aiResult.degraded,
  }

  const clauses = extractClauses(context.text)
  const clauseMatches = await matchClauseLibrary(clauses, context.orgId)
  for (const clause of clauses) {
    const libId = clauseMatches.get(clause.clauseText.slice(0, 50))
    if (libId) clause.matchedLibraryClauseId = libId
  }

  const risk_summary = calculateRiskSummary(result.risks, clauses.length, options?.strategyCode)
  const compliance_check = await performComplianceCheck(clauses, context.orgId)
  const effectiveness_analysis = generateEffectivenessAnalysis(compliance_check, risk_summary)

  return { result, risk_summary, compliance_check, effectiveness_analysis, clauses }
}

export async function saveStructuredReport(
  reviewId: string,
  contractId: string,
  report: StructuredReport,
  strategyId?: string
): Promise<void> {
  const now = new Date().toISOString()

  await supabaseAdmin.from('contract_clauses').delete().eq('review_id', reviewId)
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
    await supabaseAdmin.from('contract_clauses').insert(clauseRows)
  }

  await supabaseAdmin.from('contract_reviews').update({
    strategy_id: strategyId || null,
    risk_summary: report.risk_summary as unknown as Record<string, unknown>,
    compliance_check: report.compliance_check as unknown as Record<string, unknown>,
    effectiveness_analysis: report.effectiveness_analysis,
    report_version: 2,
    updated_at: now,
  }).eq('id', reviewId)
}
