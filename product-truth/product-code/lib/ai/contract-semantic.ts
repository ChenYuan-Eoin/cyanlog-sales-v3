import {
  executeAIUsePoint,
  type AIExecutionAttemptEvidence,
  type AIExecutionUsage,
} from '@/lib/ai/runtime-executor'
import {
  resolvePublishedAIExecutionPlan,
  type AIExecutionEnvironment,
  type AIExecutionPlan,
} from '@/lib/ai/runtime-plan'
import {
  validateAIOutput,
  type AIReviewOutput,
  type RuntimeRuleConstraint,
} from '@/lib/validation/ai-output'

export interface ContractSemanticSkillContext {
  source?: unknown
  outputSchema?: unknown
  compiledFrom?: unknown
  rules: RuntimeRuleConstraint[]
}

export interface ContractSemanticInputStats {
  original_text_length: number
  submitted_text_length: number
  estimated_page_count: number
  total_chunk_count: number
  selected_chunk_count: number
  character_coverage_ratio: number
  selection_strategy: 'full_text' | 'balanced_chunked'
  coverage_limited: boolean
}

export interface ContractSemanticReviewResult {
  risks: AIReviewOutput['risks']
  summary: string
  provider: string
  model: string
  degraded: boolean
  validationWarnings: string[]
  droppedRiskCount: number
  inputStats: ContractSemanticInputStats
  invocationId: string
  invocationIds: string[]
  planSnapshotId: string
  planSnapshotHash: string
  usage: AIExecutionUsage
  attempts: AIExecutionAttemptEvidence[]
}

export interface ExecuteContractSemanticReviewInput {
  orgId: string
  contractId: string
  reviewId?: string | null
  skillBundleId?: string | null
  contractText: string
  skillContext: ContractSemanticSkillContext
  executionEnvironment: AIExecutionEnvironment
  plan?: AIExecutionPlan
  pinModelAssetId?: string
  reviewTrigger?: string
  reviewEvent?: string
}

type ReviewTextChunk = {
  index: number
  start: number
  end: number
  content: string
  score: number
}

type ValidatedSemanticOutput = {
  data: AIReviewOutput
  warnings: string[]
  droppedRisks: number
}

function estimatePageCount(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const englishWords = text.split(/\s+/).filter((word) => /^[a-zA-Z]+$/.test(word)).length
  return Math.max(1, Math.ceil(chineseChars / 500 + englishWords / 300))
}

function candidateContextWindow(candidate: AIExecutionPlan['candidates'][number]): number {
  if (candidate.contextWindow && candidate.contextWindow > 0) return candidate.contextWindow
  // Missing catalog truth must be conservative. Local runtimes are commonly
  // loaded with an 8K context even when the model family supports more.
  return candidate.runtimeLocation === 'local' ? 8_192 : 32_768
}

function semanticBudgets(plan: AIExecutionPlan, skillContext: ContractSemanticSkillContext) {
  const contextWindow = Math.min(...plan.candidates.map(candidateContextWindow))
  const promptReserve = Math.ceil(buildContractSemanticSystemPrompt(skillContext).length * 1.2) + 768
  const maxTokens = Math.min(4_000, Math.max(512, Math.floor((contextWindow - promptReserve) * 0.45)))
  const inputCharacters = Math.min(
    120_000,
    Math.max(512, Math.floor((contextWindow - promptReserve - maxTokens - 256) * 0.8)),
  )
  return { inputCharacters, maxTokens }
}

function buildReviewChunks(text: string, inputBudget: number): ReviewTextChunk[] {
  const chunkSize = Math.max(512, Math.min(5_000, inputBudget - 160))
  const overlap = Math.min(400, Math.max(80, Math.floor(chunkSize * 0.1)))
  const chunks: ReviewTextChunk[] = []
  let start = 0
  let index = 0
  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize)
    chunks.push({ index, start, end, content: text.slice(start, end), score: 0 })
    if (end >= text.length) break
    start = Math.max(end - overlap, start + 1)
    index += 1
  }
  return chunks
}

function reviewSignalTerms(skillContext: ContractSemanticSkillContext): string[] {
  const ruleTerms = skillContext.rules.flatMap((rule) => {
    if (rule.rule_contract) {
      return rule.rule_contract.properties.flatMap((property) => [
        property.label,
        property.description || '',
        ...(property.options || []).flatMap((option) => [option.label, option.value]),
      ])
    }
    return rule.field_hints || []
  })
  return Array.from(new Set([
    ...ruleTerms,
    '付款', '退款', '验收', '违约', '赔偿', '责任上限', '保密', '知识产权',
    '源代码', '数据', 'SLA', '续约', '争议解决', '税率', '合同金额', '收款',
  ].map((term) => term.trim()).filter(Boolean)))
}

function scoreReviewChunks(chunks: ReviewTextChunk[], skillContext: ContractSemanticSkillContext) {
  const terms = reviewSignalTerms(skillContext)
  return chunks.map((chunk) => ({
    ...chunk,
    score: terms.reduce((total, term) => total + (chunk.content.includes(term) ? 1 : 0), 0),
  }))
}

function selectedCoverage(textLength: number, chunks: ReviewTextChunk[]): number {
  if (textLength === 0) return 1
  const intervals = chunks
    .map(({ start, end }) => ({ start, end }))
    .sort((left, right) => left.start - right.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const interval of intervals) {
    const last = merged[merged.length - 1]
    if (!last || interval.start > last.end) merged.push({ ...interval })
    else last.end = Math.max(last.end, interval.end)
  }
  return Math.min(1, merged.reduce((sum, item) => sum + item.end - item.start, 0) / textLength)
}

function selectBalancedChunks(
  chunks: ReviewTextChunk[],
  budget: number,
  skillContext: ContractSemanticSkillContext,
): ReviewTextChunk[] {
  const selected = new Map<number, ReviewTextChunk>()
  let used = 0
  const add = (chunk: ReviewTextChunk | undefined) => {
    if (!chunk || selected.has(chunk.index)) return
    if (selected.size > 0 && used + chunk.content.length > budget) return
    selected.set(chunk.index, chunk)
    used += chunk.content.length
  }

  // Relevant rule-bearing chunks own the scarce budget. First/last context is
  // added afterwards when it fits, so a long cover page cannot evict the very
  // clause the rule registry told us to inspect.
  for (const chunk of scoreReviewChunks(chunks, skillContext)
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)) {
    if (used >= budget) break
    add(chunk)
  }
  add(chunks[0])
  add(chunks[chunks.length - 1])
  for (let index = 1; used < budget && index < chunks.length - 1; index += 1) {
    add(chunks[index])
  }

  return [...selected.values()].sort((left, right) => left.start - right.start)
}

export function prepareContractSemanticInput(
  contractText: string,
  plan: AIExecutionPlan,
  skillContext: ContractSemanticSkillContext,
): { text: string; stats: ContractSemanticInputStats } {
  const budget = semanticBudgets(plan, skillContext).inputCharacters
  const estimatedPageCount = estimatePageCount(contractText)
  if (contractText.length <= budget) {
    return {
      text: contractText,
      stats: {
        original_text_length: contractText.length,
        submitted_text_length: contractText.length,
        estimated_page_count: estimatedPageCount,
        total_chunk_count: 1,
        selected_chunk_count: 1,
        character_coverage_ratio: 1,
        selection_strategy: 'full_text',
        coverage_limited: false,
      },
    }
  }

  const chunks = buildReviewChunks(contractText, budget)
  const selected = selectBalancedChunks(chunks, budget, skillContext)
  const submitted = selected.map((chunk) => (
    `[合同片段 ${chunk.index + 1}/${chunks.length} | 原文位置 ${chunk.start}-${chunk.end}]\n${chunk.content}`
  )).join('\n\n')
  const ratio = selectedCoverage(contractText.length, selected)
  return {
    text: submitted,
    stats: {
      original_text_length: contractText.length,
      submitted_text_length: selected.reduce((sum, chunk) => sum + chunk.content.length, 0),
      estimated_page_count: estimatedPageCount,
      total_chunk_count: chunks.length,
      selected_chunk_count: selected.length,
      character_coverage_ratio: ratio,
      selection_strategy: 'balanced_chunked',
      coverage_limited: ratio < 0.9,
    },
  }
}

function buildContractSemanticSystemPrompt(skillContext: ContractSemanticSkillContext): string {
  const rules = skillContext.rules
    .filter((rule) => rule.code)
    .map((rule) => {
      if (rule.rule_contract) {
        return `${rule.code}@v${rule.version ?? 'x'} canonical=${JSON.stringify({
          properties: rule.rule_contract.properties.map((property) => ({
            key: property.key,
            label: property.label,
            type: property.type,
            required: property.required,
            unit: property.unit || property.currency || null,
            options: property.options || [],
          })),
        })}`
      }
      return `${rule.code}@v${rule.version ?? 'x'} legacy_adapter ${rule.clause_category || ''} ${(rule.field_hints || []).join('/')}`.trim()
    })
    .join('\n')

  return [
    '你是 ONES 业务运营合同审核角色。',
    '只依据已发布规则快照和合同原文读取事实；不得编造属性、规则、数字、日期、主体或条款。',
    'canonical 规则只读取该规则已定义属性，判定条件、风险等级和处理动作由服务端规则引擎独立执行。',
    'canonical 每个属性必须返回 propertyReadings：propertyKey、status、类型正确的 value、unit、逐字 evidence、0-1 confidence。',
    'legacy_adapter 仅返回高置信风险；每条 evidence 必须是合同原文连续片段，不能摘要、拼接或只给通用词。',
    '输出 JSON 对象，不要 Markdown或解释前后缀。',
    '格式：{"risks":[{"ruleCode":"R001","ruleVersion":1,"propertyReadings":[{"propertyKey":"amount","status":"read|missing|ambiguous|unit_conflict","value":50000,"unit":"CNY","evidence":"逐字原文","confidence":0.95}]}],"summary":"总体评估"}',
    'legacy_adapter 才输出 level/title/description/suggestion/evidence；canonical 不自行做风险判断。',
    rules ? `可用规则快照：\n${rules}` : '可用规则快照缺失：返回空 risks 并说明未绑定。',
  ].join('\n')
}

export async function executeContractSemanticReview(
  input: ExecuteContractSemanticReviewInput,
): Promise<ContractSemanticReviewResult> {
  const plan = input.plan ?? await resolvePublishedAIExecutionPlan({
    orgId: input.orgId,
    usePointId: 'contract.review.semantic',
    executionEnvironment: input.executionEnvironment,
  })
  const prepared = prepareContractSemanticInput(input.contractText, plan, input.skillContext)
  const budgets = semanticBudgets(plan, input.skillContext)
  const result = await executeAIUsePoint<ValidatedSemanticOutput>({
    orgId: input.orgId,
    usePointId: 'contract.review.semantic',
    executionEnvironment: input.executionEnvironment,
    plan,
    pinModelAssetId: input.pinModelAssetId,
    contractId: input.contractId,
    reviewId: input.reviewId,
    skillBundleId: input.skillBundleId,
    maxTokens: budgets.maxTokens,
    messages: [
      { role: 'system', content: buildContractSemanticSystemPrompt(input.skillContext) },
      {
        role: 'user',
        content: [
          '请审核以下合同。',
          `输入覆盖率：${Math.round(prepared.stats.character_coverage_ratio * 100)}%，选择策略：${prepared.stats.selection_strategy}。`,
          prepared.stats.coverage_limited
            ? '本次不是全文覆盖：只报告片段内可逐字定位的属性或风险，不得把未出现误报为全文缺失。'
            : '本次为全文覆盖：canonical 规则必须完整返回每个已定义属性的读取状态。',
          prepared.text,
        ].join('\n\n'),
      },
    ],
    validateOutput: (text) => {
      const validation = validateAIOutput(text, {
        contractText: input.contractText,
        rules: input.skillContext.rules,
        requireEvidenceInSource: true,
        requireRuleEvidenceHint: true,
        allowPartialRiskAcceptance: true,
      })
      return validation.valid && validation.data
        ? {
            ok: true,
            value: {
              data: validation.data,
              warnings: validation.warnings || [],
              droppedRisks: validation.droppedRisks || 0,
            },
          }
        : { ok: false, error: validation.error || '合同语义输出未通过校验' }
    },
    requestMeta: {
      review_trigger: input.reviewTrigger || 'direct',
      review_event: input.reviewEvent || 'initial_generate',
      skill_rule_count: input.skillContext.rules.length,
      input_stats: prepared.stats,
    },
  })

  return {
    risks: result.value.data.risks,
    summary: result.value.data.summary,
    provider: result.provider,
    model: result.model,
    degraded: result.degraded,
    validationWarnings: result.value.warnings,
    droppedRiskCount: result.value.droppedRisks,
    inputStats: prepared.stats,
    invocationId: result.invocationId,
    invocationIds: result.invocationIds,
    planSnapshotId: result.planSnapshotId,
    planSnapshotHash: result.planSnapshotHash,
    usage: result.usage,
    attempts: result.attempts,
  }
}
