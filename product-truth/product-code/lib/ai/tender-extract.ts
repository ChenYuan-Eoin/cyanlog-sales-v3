import { z } from 'zod'

import {
  executeAIUsePoint,
  type AIExecutionResult,
  type ExecuteAIUsePointInput,
} from '@/lib/ai/runtime-executor'
import {
  resolvePublishedAIExecutionPlan,
  type AIExecutionEnvironment,
  type AIExecutionPlan,
} from '@/lib/ai/runtime-plan'
import type {
  TenderKeyInfo,
  TenderScore,
  TenderTimeline,
} from '@/lib/ocr/tender-parser'
import { DocumentChunker, type Chunk } from '@/lib/rag/chunker'

const tenderScoreSchema = z.object({
  item: z.string().trim().min(1).max(300),
  weight: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(1000).optional(),
}).strict()

const tenderTimelineSchema = z.object({
  event: z.string().trim().min(1).max(300),
  date: z.string().trim().min(1).max(100),
}).strict()

const tenderChunkOutputSchema = z.object({
  noRelevantInformation: z.boolean(),
  tenderNo: z.string().trim().max(200).optional(),
  tenderName: z.string().trim().max(500).optional(),
  budget: z.string().trim().max(200).optional(),
  deadline: z.string().trim().max(200).optional(),
  publisher: z.string().trim().max(500).optional(),
  contact: z.string().trim().max(300).optional(),
  scores: z.array(tenderScoreSchema).max(40).default([]),
  technicalRequirements: z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  commercialTerms: z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  timeline: z.array(tenderTimelineSchema).max(40).default([]),
}).strict().superRefine((value, ctx) => {
  const signals = tenderChunkBusinessSignals(value)
  if (signals === 0 && !value.noRelevantInformation) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '无字段时必须明确 noRelevantInformation=true' })
  }
  if (signals > 0 && value.noRelevantInformation) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '存在字段时不能标记 noRelevantInformation=true' })
  }
})

export type TenderChunkOutput = z.infer<typeof tenderChunkOutputSchema>

export interface TenderAIExecutionRuntime {
  source: 'published_ai_runtime'
  provider: string
  model: string
  transport: 'openai_compatible_http'
  chunk_count: number
  selected_chunk_count: number
  analyzed_chunk_count: number
  text_length: number
  selected_text_length: number
  analyzed_text_length: number
  coverage_ratio: number
  chunk_coverage_ratio: number
  character_coverage_ratio: number
  business_signal_count: number
  business_signal_domains: number
  processing_ms: number
  concurrency: number
  degraded: boolean
  attempt_errors: string[]
  plan_snapshot_hash: string
  plan_snapshot_ids: string[]
  model_invocation_id?: string
  model_invocation_ids: string[]
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

export interface TenderAIExtractionResult {
  keyInfo: TenderKeyInfo & { aiRuntime: TenderAIExecutionRuntime }
  runtime: TenderAIExecutionRuntime
}

export class TenderAIOutputError extends Error {
  constructor(public readonly code: 'EMPTY_TEXT' | 'DOCUMENT_TOO_LARGE' | 'NO_BUSINESS_SIGNALS', message: string) {
    super(message)
    this.name = 'TenderAIOutputError'
  }
}

type ExecuteUsePoint = <T = string>(
  input: ExecuteAIUsePointInput<T>,
) => Promise<AIExecutionResult<T>>

export interface TenderAIExtractionDependencies {
  resolvePlan?: typeof resolvePublishedAIExecutionPlan
  execute?: ExecuteUsePoint
  now?: () => number
}

export interface TenderAIExtractionInput {
  orgId: string
  text: string
  base: TenderKeyInfo
  executionEnvironment: AIExecutionEnvironment
  fileName: string
  mimeType: string
  sizeBytes: number
  maxChunks?: number
  concurrency?: number
}

function stripModelEnvelope(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

export function validateTenderChunkOutput(text: string) {
  const normalized = stripModelEnvelope(text)
  const start = normalized.indexOf('{')
  const end = normalized.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return { ok: false as const, error: '输出不是 JSON 对象' }
  }
  try {
    const parsed = tenderChunkOutputSchema.safeParse(JSON.parse(normalized.slice(start, end + 1)))
    return parsed.success
      ? { ok: true as const, value: parsed.data }
      : {
          ok: false as const,
          error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'output'}: ${issue.message}`).join('；'),
        }
  } catch {
    return { ok: false as const, error: '输出 JSON 无法解析' }
  }
}

function tenderChunkBusinessSignals(value: {
  tenderNo?: string
  tenderName?: string
  budget?: string
  deadline?: string
  publisher?: string
  contact?: string
  scores?: unknown[]
  technicalRequirements?: unknown[]
  commercialTerms?: unknown[]
  timeline?: unknown[]
}): number {
  return [
    value.tenderNo,
    value.tenderName,
    value.budget,
    value.deadline,
    value.publisher,
    value.contact,
  ].filter((item) => typeof item === 'string' && item.trim()).length
    + (value.scores?.length || 0)
    + (value.technicalRequirements?.length || 0)
    + (value.commercialTerms?.length || 0)
    + (value.timeline?.length || 0)
}

function businessSignalSummary(values: readonly TenderChunkOutput[]) {
  const domains = new Set<string>()
  let count = 0
  for (const value of values) {
    const scalarCount = [
      value.tenderNo,
      value.tenderName,
      value.budget,
      value.deadline,
      value.publisher,
      value.contact,
    ].filter((item) => typeof item === 'string' && item.trim()).length
    if (scalarCount > 0) domains.add('scalar')
    if (value.scores.length > 0) domains.add('scores')
    if (value.technicalRequirements.length > 0) domains.add('technicalRequirements')
    if (value.commercialTerms.length > 0) domains.add('commercialTerms')
    if (value.timeline.length > 0) domains.add('timeline')
    count += tenderChunkBusinessSignals(value)
  }
  return { count, domains: domains.size }
}

function compactList(values: readonly (string | null | undefined)[], limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, ' ').trim() || ''
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= limit) break
  }
  return result
}

function mergeScores(values: readonly (Partial<TenderScore> & { item?: string })[]): TenderScore[] {
  const seen = new Set<string>()
  const result: TenderScore[] = []
  for (const value of values) {
    const item = value.item?.replace(/\s+/g, ' ').trim()
    if (!item) continue
    const weight = Number(value.weight || 0)
    const maxScore = Number(value.maxScore || value.weight || 0)
    const key = `${item}-${weight}-${maxScore}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      item,
      weight: Number.isFinite(weight) ? weight : 0,
      maxScore: Number.isFinite(maxScore) ? maxScore : 0,
    })
    if (result.length >= 40) break
  }
  return result
}

function mergeTimeline(values: readonly TenderTimeline[]): TenderTimeline[] {
  const seen = new Set<string>()
  const result: TenderTimeline[] = []
  for (const value of values) {
    const event = value.event?.replace(/\s+/g, ' ').trim()
    const date = value.date?.replace(/\s+/g, ' ').trim()
    if (!event || !date) continue
    const key = `${event}-${date}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ event, date })
    if (result.length >= 40) break
  }
  return result
}

function preferAIValue(base: string | undefined, values: readonly (string | undefined)[]) {
  return values.find((value) => value?.trim())?.trim() || base
}

function mergeTenderResults(base: TenderKeyInfo, values: readonly TenderChunkOutput[]): TenderKeyInfo {
  const scores = mergeScores([
    ...(base.scores || []),
    ...values.flatMap((value) => value.scores),
  ])
  const technicalRequirements = compactList([
    ...(base.technicalRequirements || []),
    ...values.flatMap((value) => value.technicalRequirements),
  ], 100)
  const commercialTerms = compactList([
    ...(base.commercialTerms || []),
    ...values.flatMap((value) => value.commercialTerms),
  ], 100)
  const timeline = mergeTimeline([
    ...(base.timeline || []),
    ...values.flatMap((value) => value.timeline),
  ])
  const scalars = [
    preferAIValue(base.tenderNo, values.map((value) => value.tenderNo)),
    preferAIValue(base.tenderName, values.map((value) => value.tenderName)),
    preferAIValue(base.budget, values.map((value) => value.budget)),
    preferAIValue(base.deadline, values.map((value) => value.deadline)),
    preferAIValue(base.publisher, values.map((value) => value.publisher)),
    preferAIValue(base.contact, values.map((value) => value.contact)),
  ]
  const scalarCount = scalars.filter(Boolean).length
  const extendedCount = [scores.length, technicalRequirements.length, commercialTerms.length, timeline.length]
    .filter((count) => count > 0).length

  return {
    ...base,
    tenderNo: scalars[0],
    tenderName: scalars[1],
    budget: scalars[2],
    deadline: scalars[3],
    publisher: scalars[4],
    contact: scalars[5],
    scores,
    technicalRequirements,
    commercialTerms,
    timeline,
    confidence: Math.min(100, Math.max(base.confidence, Math.round((scalarCount / 6) * 60 + extendedCount * 10))),
  }
}

function buildPrompt(chunk: Chunk, total: number): string {
  return [
    `这是招标文件第 ${chunk.index + 1}/${total} 个连续片段。`,
    '只提取片段原文明示的信息，禁止补全、猜测或引用片段外事实。',
    '只输出一个 JSON 对象，不要 Markdown。结构：',
    '{"noRelevantInformation":false,"tenderNo":"","tenderName":"","budget":"","deadline":"","publisher":"","contact":"","scores":[{"item":"","weight":0,"maxScore":0}],"technicalRequirements":[],"commercialTerms":[],"timeline":[{"event":"","date":""}]}',
    '没有任何可提取信息时，输出 noRelevantInformation=true 且其他字符串省略、数组为空。',
    '片段原文：',
    chunk.content,
  ].join('\n')
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      result[index] = await mapper(values[index])
    }
  }))
  return result
}

function sum(values: readonly (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value || 0), 0)
}

/**
 * Parse every bounded chunk through one already-published six-object plan.
 * No chunk may silently fall back to legacy policy, environment credentials,
 * CLI output, deterministic rules or a fabricated model invocation.
 */
export async function extractTenderWithAIPlan(
  input: TenderAIExtractionInput,
  dependencies: TenderAIExtractionDependencies = {},
): Promise<TenderAIExtractionResult> {
  if (!input.text.trim()) throw new TenderAIOutputError('EMPTY_TEXT', '标书正文为空')

  const chunker = new DocumentChunker({ strategy: 'paragraph', chunkSize: 6000, overlap: 400 })
  const chunks = chunker.chunk(input.text, { source: 'tender_upload' })
  const maxChunks = Math.max(1, Math.min(input.maxChunks ?? 30, 80))
  if (chunks.length > maxChunks) {
    throw new TenderAIOutputError(
      'DOCUMENT_TOO_LARGE',
      `标书被分为 ${chunks.length} 个片段，超过单次可审计上限 ${maxChunks}；未静默截断。`,
    )
  }

  const resolvePlan = dependencies.resolvePlan ?? resolvePublishedAIExecutionPlan
  const execute = dependencies.execute ?? executeAIUsePoint
  const now = dependencies.now ?? Date.now
  const plan: AIExecutionPlan = await resolvePlan({
    orgId: input.orgId,
    usePointId: 'tender.document.extract',
    executionEnvironment: input.executionEnvironment,
  })
  const startedAt = now()
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 2, 4, chunks.length))
  const executions = await mapWithConcurrency(chunks, concurrency, (chunk) => (
    execute<TenderChunkOutput>({
      orgId: input.orgId,
      usePointId: 'tender.document.extract',
      executionEnvironment: input.executionEnvironment,
      plan,
      messages: [
        {
          role: 'system',
          content: '你是企业标书结构化提取助手。只输出与输入片段逐字可核对的严格 JSON。',
        },
        { role: 'user', content: buildPrompt(chunk, chunks.length) },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0,
      maxTokens: 1800,
      validateOutput: validateTenderChunkOutput,
      requestMeta: {
        file_name: input.fileName,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        chunk_index: chunk.index,
        chunk_count: chunks.length,
        chunk_character_count: chunk.content.length,
      },
    })
  ))
  const values = executions.map((execution) => execution.value)
  const signals = businessSignalSummary(values)
  if (signals.count <= 0) {
    throw new TenderAIOutputError('NO_BUSINESS_SIGNALS', '模型完成解析但没有提取到任何标书业务字段')
  }

  const providers = [...new Set(executions.map((execution) => execution.provider))]
  const models = [...new Set(executions.map((execution) => execution.model))]
  const planSnapshotIds = [...new Set(executions.map((execution) => execution.planSnapshotId))]
  const planSnapshotHashes = [...new Set(executions.map((execution) => execution.planSnapshotHash))]
  if (planSnapshotHashes.length !== 1 || planSnapshotHashes[0] !== plan.snapshotHash) {
    throw new Error('标书分块调用没有绑定同一不可漂移运行计划')
  }
  const modelInvocationIds = executions.flatMap((execution) => execution.invocationIds)
  const runtime: TenderAIExecutionRuntime = {
    source: 'published_ai_runtime',
    provider: providers.join(' → '),
    model: models.join(' → '),
    transport: 'openai_compatible_http',
    chunk_count: chunks.length,
    selected_chunk_count: chunks.length,
    analyzed_chunk_count: executions.length,
    text_length: input.text.length,
    selected_text_length: input.text.length,
    analyzed_text_length: input.text.length,
    coverage_ratio: 1,
    chunk_coverage_ratio: 1,
    character_coverage_ratio: 1,
    business_signal_count: signals.count,
    business_signal_domains: signals.domains,
    processing_ms: Math.max(0, now() - startedAt),
    concurrency,
    degraded: executions.some((execution) => execution.degraded),
    attempt_errors: executions.flatMap((execution) => execution.attempts
      .filter((attempt) => attempt.status === 'failed' && attempt.errorMessage)
      .map((attempt) => attempt.errorMessage as string)),
    plan_snapshot_hash: plan.snapshotHash,
    plan_snapshot_ids: planSnapshotIds,
    model_invocation_id: executions[0]?.invocationId,
    model_invocation_ids: modelInvocationIds,
    input_tokens: sum(executions.map((execution) => execution.usage.inputTokens)),
    output_tokens: sum(executions.map((execution) => execution.usage.outputTokens)),
    total_tokens: sum(executions.map((execution) => execution.usage.totalTokens)),
  }
  return {
    keyInfo: { ...mergeTenderResults(input.base, values), aiRuntime: runtime },
    runtime,
  }
}
