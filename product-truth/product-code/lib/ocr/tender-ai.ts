import { z } from 'zod'
import { generateTextWithFailover, type AITransport } from '@/lib/ai/failover'
import { DocumentChunker, type Chunk } from '@/lib/rag/chunker'
import type { TenderKeyInfo, TenderScore, TenderTimeline } from '@/lib/ocr/tender-parser'

const tenderScoreSchema = z.object({
  item: z.string().trim().min(1),
  weight: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(1000).optional(),
})

const tenderTimelineSchema = z.object({
  event: z.string().trim().min(1),
  date: z.string().trim().min(1),
})

const tenderAIResultSchema = z.object({
  tenderNo: z.string().trim().optional(),
  tenderName: z.string().trim().optional(),
  budget: z.string().trim().optional(),
  deadline: z.string().trim().optional(),
  publisher: z.string().trim().optional(),
  contact: z.string().trim().optional(),
  scores: z.array(tenderScoreSchema).optional(),
  technicalRequirements: z.array(z.string().trim().min(1)).optional(),
  commercialTerms: z.array(z.string().trim().min(1)).optional(),
  timeline: z.array(tenderTimelineSchema).optional(),
})

type TenderAIResult = z.infer<typeof tenderAIResultSchema>

type TenderChunkResult = {
  chunk: Chunk
  parsed?: TenderAIResult
  runtime?: {
    provider: string
    model: string
    transport: AITransport
  }
  errors: string[]
}

export type TenderAIRuntime = {
  source: 'cloud_model'
  provider: string
  model: string
  transport: AITransport
  chunk_count: number
  selected_chunk_count: number
  analyzed_chunk_count: number
  text_length: number
  selected_text_length: number
  analyzed_text_length: number
  coverage_ratio: number
  chunk_coverage_ratio: number
  character_coverage_ratio: number
  processing_ms: number
  concurrency: number
  business_signal_count: number
  business_signal_domains: number
  degraded: boolean
  attempt_errors: string[]
  model_invocation_id?: string
}

export type TenderAIAnalysisResult = {
  keyInfo: TenderKeyInfo & { aiRuntime: TenderAIRuntime }
  runtime: TenderAIRuntime
}

function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim()
}

export function extractJsonObject(text: string): unknown {
  const cleaned = stripReasoning(text)
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('AI tender parser did not return a JSON object')
  }
  return JSON.parse(cleaned.slice(start, end + 1))
}

function compactList(values: Array<string | undefined | null>, limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim()
      : ''
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= limit) break
  }
  return result
}

function mergeScores(values: Array<Partial<TenderScore> & { item?: string }>, limit = 30): TenderScore[] {
  const seen = new Set<string>()
  const result: TenderScore[] = []
  for (const score of values) {
    const item = score.item?.replace(/\s+/g, ' ').trim()
    if (!item) continue
    const weight = Number(score.weight || 0)
    const maxScore = Number(score.maxScore || score.weight || 0)
    const key = `${item}-${weight || maxScore}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      item,
      weight: Number.isFinite(weight) ? weight : 0,
      maxScore: Number.isFinite(maxScore) ? maxScore : 0,
    })
    if (result.length >= limit) break
  }
  return result
}

function mergeTimeline(values: TenderTimeline[], limit = 30): TenderTimeline[] {
  const seen = new Set<string>()
  const result: TenderTimeline[] = []
  for (const item of values) {
    const event = item.event?.replace(/\s+/g, ' ').trim()
    const date = item.date?.replace(/\s+/g, ' ').trim()
    if (!event || !date) continue
    const key = `${event}-${date}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ event, date })
    if (result.length >= limit) break
  }
  return result
}

function chooseString(...values: Array<string | undefined | null>): string | undefined {
  return values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] || undefined
}

function tenderAIResultBusinessSignals(result: TenderAIResult) {
  const scalarCount = [
    result.tenderNo,
    result.tenderName,
    result.budget,
    result.deadline,
    result.publisher,
    result.contact,
  ].filter((value) => typeof value === 'string' && value.trim().length > 0).length
  const scoresCount = Array.isArray(result.scores) ? result.scores.length : 0
  const technicalCount = Array.isArray(result.technicalRequirements) ? result.technicalRequirements.length : 0
  const commercialCount = Array.isArray(result.commercialTerms) ? result.commercialTerms.length : 0
  const timelineCount = Array.isArray(result.timeline) ? result.timeline.length : 0

  return {
    count: scalarCount + scoresCount + technicalCount + commercialCount + timelineCount,
    domains: [
      scalarCount,
      scoresCount,
      technicalCount,
      commercialCount,
      timelineCount,
    ].filter((count) => count > 0).length,
  }
}

function tenderAIResultsBusinessSignals(results: TenderAIResult[]) {
  const domains = new Set<string>()
  const count = results.reduce((total, result) => {
    const current = tenderAIResultBusinessSignals(result)
    if ([result.tenderNo, result.tenderName, result.budget, result.deadline, result.publisher, result.contact]
      .some((value) => typeof value === 'string' && value.trim().length > 0)) domains.add('scalar')
    if (Array.isArray(result.scores) && result.scores.length > 0) domains.add('scores')
    if (Array.isArray(result.technicalRequirements) && result.technicalRequirements.length > 0) domains.add('technicalRequirements')
    if (Array.isArray(result.commercialTerms) && result.commercialTerms.length > 0) domains.add('commercialTerms')
    if (Array.isArray(result.timeline) && result.timeline.length > 0) domains.add('timeline')
    return total + current.count
  }, 0)

  return { count, domains: domains.size }
}

export function mergeTenderAIResults(base: TenderKeyInfo, aiResults: TenderAIResult[]): TenderKeyInfo {
  const scores = mergeScores([
    ...(base.scores || []),
    ...aiResults.flatMap((result) => result.scores || []),
  ])
  const technicalRequirements = compactList([
    ...(base.technicalRequirements || []),
    ...aiResults.flatMap((result) => result.technicalRequirements || []),
  ], 80)
  const commercialTerms = compactList([
    ...(base.commercialTerms || []),
    ...aiResults.flatMap((result) => result.commercialTerms || []),
  ], 60)
  const timeline = mergeTimeline([
    ...(base.timeline || []),
    ...aiResults.flatMap((result) => result.timeline || []),
  ])
  const scalarSignals = [
    chooseString(base.tenderNo, ...aiResults.map((result) => result.tenderNo)),
    chooseString(base.tenderName, ...aiResults.map((result) => result.tenderName)),
    chooseString(base.budget, ...aiResults.map((result) => result.budget)),
    chooseString(base.deadline, ...aiResults.map((result) => result.deadline)),
    chooseString(base.publisher, ...aiResults.map((result) => result.publisher)),
    chooseString(base.contact, ...aiResults.map((result) => result.contact)),
  ].filter(Boolean).length
  const extendedSignals = [scores.length, technicalRequirements.length, commercialTerms.length, timeline.length]
    .filter((count) => count > 0).length

  return {
    ...base,
    tenderNo: chooseString(base.tenderNo, ...aiResults.map((result) => result.tenderNo)),
    tenderName: chooseString(base.tenderName, ...aiResults.map((result) => result.tenderName)),
    budget: chooseString(base.budget, ...aiResults.map((result) => result.budget)),
    deadline: chooseString(base.deadline, ...aiResults.map((result) => result.deadline)),
    publisher: chooseString(base.publisher, ...aiResults.map((result) => result.publisher)),
    contact: chooseString(base.contact, ...aiResults.map((result) => result.contact)),
    scores,
    technicalRequirements,
    commercialTerms,
    timeline,
    confidence: Math.min(100, Math.max(base.confidence, Math.round((scalarSignals / 6) * 60 + extendedSignals * 10))),
  }
}

function buildTenderPrompt(chunk: string, index: number, total: number): string {
  return [
    `这是招标/标书文档的第 ${index + 1}/${total} 个片段。`,
    '请只基于本片段提取结构化信息；片段中没有明确出现的信息不要猜。',
    '输出 JSON 对象，字段为：',
    '{ "tenderNo": "", "tenderName": "", "budget": "", "deadline": "", "publisher": "", "contact": "", "scores": [{"item":"","weight":0,"maxScore":0}], "technicalRequirements": [], "commercialTerms": [], "timeline": [{"event":"","date":""}] }',
    '评分标准要保留评分项、权重、最高分；技术要求保留可执行约束；商务条款保留付款、交付、质保、保证金、违约、服务承诺等约束；时间节点保留报名、答疑、投标截止、开标、中标、公示、签约等节点。',
    '禁止 Markdown，禁止解释，禁止输出片段外推断。',
    '片段文本：',
    chunk,
  ].join('\n')
}

const TENDER_KEYWORDS = [
  '评分', '评审', '评分标准', '评分办法', '评标办法', '技术分', '商务分', '价格分',
  '投标截止', '开标', '报名', '答疑', '澄清', '保证金', '履约保证金',
  '付款', '结算', '交付', '交货', '质保', '售后', '违约', '服务承诺',
  '采购人', '招标人', '预算', '最高限价', '合同', '技术要求', '商务条款',
]

function chunkKeywordScore(chunk: Chunk): number {
  return TENDER_KEYWORDS.reduce((score, keyword) => (
    chunk.content.includes(keyword) ? score + 1 : score
  ), 0)
}

function addChunkIndex(target: Set<number>, chunks: Chunk[], index: number, limit = Number.POSITIVE_INFINITY) {
  if (target.size < limit && chunks[index]) {
    target.add(chunks[index].index)
  }
}

export function selectTenderChunks(chunks: Chunk[], maxChunks: number): Chunk[] {
  if (chunks.length <= maxChunks) return chunks

  const limit = Math.max(1, maxChunks)
  const selectedIndexes = new Set<number>()
  const edgeCount = Math.min(3, Math.ceil(limit / 3))

  for (let index = 0; index < edgeCount; index += 1) {
    addChunkIndex(selectedIndexes, chunks, index, limit)
    addChunkIndex(selectedIndexes, chunks, chunks.length - 1 - index, limit)
  }

  const highSignal = [...chunks]
    .map((chunk) => ({ chunk, score: chunkKeywordScore(chunk) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.index - right.chunk.index)

  for (const item of highSignal) {
    if (selectedIndexes.size >= limit) break
    selectedIndexes.add(item.chunk.index)
  }

  const remainingSlots = limit - selectedIndexes.size
  if (remainingSlots > 0) {
    const step = chunks.length / (remainingSlots + 1)
    for (let i = 1; i <= remainingSlots; i += 1) {
      const approxIndex = Math.min(chunks.length - 1, Math.max(0, Math.round(step * i)))
      addChunkIndex(selectedIndexes, chunks, approxIndex, limit)
    }
  }

  for (const chunk of chunks) {
    if (selectedIndexes.size >= limit) break
    selectedIndexes.add(chunk.index)
  }

  return chunks.filter((chunk) => selectedIndexes.has(chunk.index))
}

function sumContentLength(chunks: Chunk[]) {
  return chunks.reduce((total, chunk) => total + chunk.content.length, 0)
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0
  return Math.min(1, Number((numerator / denominator).toFixed(4)))
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(values.length)
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(concurrency, values.length))

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(values[currentIndex])
    }
  }))

  return results
}

async function analyzeTenderChunk(
  chunk: Chunk,
  totalChunks: number,
  options: { orgId?: string | null; preferredProvider?: string; maxAttempts?: number }
): Promise<TenderChunkResult> {
  const errors: string[] = []
  const maxAttempts = Math.max(1, options.maxAttempts || 2)
  let runtime: TenderChunkResult['runtime']

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await generateTextWithFailover(buildTenderPrompt(chunk.content, chunk.index, totalChunks), {
        orgId: options.orgId || undefined,
        preferredProvider: options.preferredProvider || 'cloud',
        system: '你是 ONES 标书解析助手，专门从长文本招标文件中提取结构化字段。必须输出严格 JSON。',
      }, 1)
      errors.push(...(result.attemptErrors || []))
      runtime = {
        provider: result.provider,
        model: result.model,
        transport: result.transport,
      }

      let parsedJson: unknown
      try {
        parsedJson = extractJsonObject(result.text)
      } catch (error) {
        errors.push(`chunk_${chunk.index}_attempt_${attempt}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }

      const parsed = tenderAIResultSchema.safeParse(parsedJson)
      if (!parsed.success) {
        errors.push(`chunk_${chunk.index}_attempt_${attempt}: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`)
        continue
      }

      return {
        chunk,
        parsed: parsed.data,
        runtime,
        errors,
      }
    } catch (error) {
      errors.push(`chunk_${chunk.index}_attempt_${attempt}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    chunk,
    runtime,
    errors,
  }
}

export async function analyzeTenderWithCloudModel(
  text: string,
  base: TenderKeyInfo,
  options: { orgId?: string | null; maxChunks?: number; concurrency?: number; preferredProvider?: string } = {}
): Promise<TenderAIAnalysisResult | null> {
  if (!text.trim() || /^\[.*\]$/.test(text.trim())) {
    return null
  }

  const chunker = new DocumentChunker({ strategy: 'paragraph', chunkSize: 6000, overlap: 400 })
  const chunks = chunker.chunk(text, { source: 'tender_upload' })
  const maxChunks = Math.max(1, options.maxChunks || 30)
  const selectedChunks = selectTenderChunks(chunks, maxChunks)
  const startedAt = Date.now()
  const concurrency = Math.max(1, Math.min(options.concurrency || 2, 4, selectedChunks.length || 1))

  const attemptErrors: string[] = []
  if (selectedChunks.length < chunks.length) {
    attemptErrors.push(`chunk_limit_reached: analyzed ${selectedChunks.length}/${chunks.length} chunks`)
  }

  const chunkResults = await mapWithConcurrency(
    selectedChunks,
    concurrency,
    (chunk) => analyzeTenderChunk(chunk, chunks.length, {
      orgId: options.orgId,
      preferredProvider: options.preferredProvider || 'cloud',
    })
  )
  const parsedChunkResults = chunkResults.filter((result) => result.parsed)
  const parsedResults = parsedChunkResults
    .map((result) => result.parsed)
    .filter((result): result is TenderAIResult => Boolean(result))
  const runtime = chunkResults.find((result) => result.runtime)?.runtime || null
  attemptErrors.push(...chunkResults.flatMap((result) => result.errors))

  if (!runtime) {
    throw new Error(attemptErrors[0] || 'cloud tender parser did not reach a model provider')
  }

  const businessSignals = tenderAIResultsBusinessSignals(parsedResults)
  if (businessSignals.count <= 0) {
    throw new Error('cloud tender parser returned no business signals')
  }

  const textLength = text.length
  const selectedTextLength = sumContentLength(selectedChunks)
  const analyzedTextLength = sumContentLength(parsedChunkResults.map((result) => result.chunk))
  const chunkCoverageRatio = ratio(parsedChunkResults.length, chunks.length)
  const characterCoverageRatio = ratio(analyzedTextLength, textLength)
  const selectedCharacterCoverageRatio = ratio(selectedTextLength, textLength)

  const finalRuntime: TenderAIRuntime = {
    source: 'cloud_model',
    ...runtime,
    chunk_count: chunks.length,
    selected_chunk_count: selectedChunks.length,
    analyzed_chunk_count: parsedChunkResults.length,
    text_length: textLength,
    selected_text_length: selectedTextLength,
    analyzed_text_length: analyzedTextLength,
    coverage_ratio: characterCoverageRatio,
    chunk_coverage_ratio: chunkCoverageRatio,
    character_coverage_ratio: characterCoverageRatio,
    processing_ms: Date.now() - startedAt,
    concurrency,
    business_signal_count: businessSignals.count,
    business_signal_domains: businessSignals.domains,
    degraded: parsedChunkResults.length < selectedChunks.length || selectedChunks.length < chunks.length,
    attempt_errors: attemptErrors,
  }
  if (selectedChunks.length < chunks.length) {
    finalRuntime.attempt_errors.push(`character_coverage_limited: selected ${Math.round(selectedCharacterCoverageRatio * 100)}% of text`)
  }

  return {
    keyInfo: {
      ...mergeTenderAIResults(base, parsedResults),
      aiRuntime: finalRuntime,
    },
    runtime: finalRuntime,
  }
}
