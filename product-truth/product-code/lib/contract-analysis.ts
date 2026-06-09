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
