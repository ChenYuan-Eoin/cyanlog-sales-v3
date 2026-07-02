// 标书专用结构化解析器
// 复用 F008 的基础 OCR 能力，扩展为标书场景的结构化提取
// 来源：product-truth/01-business-truth/标书中心.md#3

import { extractKeyInfo, type OCRResult } from './parser'

export interface TenderScore {
  item: string
  weight: number
  maxScore: number
}

export interface TenderTimeline {
  event: string
  date: string
}

export interface TenderAIRuntimeInfo {
  source?: 'cloud_model' | string
  provider?: string
  model?: string
  transport?: string
  chunk_count?: number
  selected_chunk_count?: number
  analyzed_chunk_count?: number
  text_length?: number
  selected_text_length?: number
  analyzed_text_length?: number
  coverage_ratio?: number
  chunk_coverage_ratio?: number
  character_coverage_ratio?: number
  processing_ms?: number
  concurrency?: number
  business_signal_count?: number
  business_signal_domains?: number
  degraded?: boolean
  attempt_errors?: string[]
  model_invocation_id?: string
}

export interface TenderKeyInfo extends OCRResult {
  // 基础字段继承自 OCRResult (tenderNo, tenderName, budget, deadline, publisher, contact)
  scores: TenderScore[]
  technicalRequirements: string[]
  commercialTerms: string[]
  timeline: TenderTimeline[]
  aiRuntime?: TenderAIRuntimeInfo
}

/**
 * 解析标书关键信息（结构化）
 * 在 F008 基础提取之上，扩展：
 * - 评分标准
 * - 技术要求
 * - 商务条款
 * - 时间节点
 */
export function extractTenderInfo(text: string): TenderKeyInfo {
  const base = extractKeyInfo(text)
  const result: TenderKeyInfo = {
    ...base,
    scores: extractScores(text),
    technicalRequirements: extractTechnicalRequirements(text),
    commercialTerms: extractCommercialTerms(text),
    timeline: extractTimeline(text),
  }

  // 总信心度：基础 6 字段平均 + 4 类扩展各 10 分
  const baseCount = [base.tenderNo, base.tenderName, base.budget, base.deadline, base.publisher, base.contact].filter(Boolean).length
  const extendedCount = [result.scores.length, result.technicalRequirements.length, result.commercialTerms.length, result.timeline.length]
    .filter((n) => n > 0).length
  result.confidence = Math.min(100, Math.round((baseCount / 6) * 60 + extendedCount * 10))

  return result
}

/**
 * 提取评分标准
 * 格式示例：
 *   "技术方案 权重 30% 满分 30"
 *   "商务报价 权重 40% 满分 40"
 */
function extractScores(text: string): TenderScore[] {
  const scores: TenderScore[] = []
  // 匹配 "项目 权重 30 满分 30" 或 "项目 30% 30 分"
  const patterns = [
    /([\u4e00-\u9fa5A-Za-z]+?)\s*[：:]?\s*权重[：:为是]?\s*(\d+(?:\.\d+)?)\s*%?[^。\n]{0,30}?(?:满[分]?|最高|分值)[：:]?\s*(\d+(?:\.\d+)?)/g,
    /([\u4e00-\u9fa5A-Za-z]{2,20})\s+(\d+(?:\.\d+)?)\s*%[^。\n]{0,30}?(\d+(?:\.\d+)?)\s*分/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const item = match[1].trim()
      const weight = parseFloat(match[2])
      const maxScore = parseFloat(match[3])
      if (item && !isNaN(weight) && !isNaN(maxScore) && weight > 0 && maxScore > 0 && weight <= 100) {
        scores.push({ item, weight, maxScore })
      }
    }
  }

  // 去重（按 item + weight）
  const seen = new Set<string>()
  return scores.filter((s) => {
    const key = `${s.item}-${s.weight}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 提取技术要求
 * 匹配"技术要求"、"技术参数"、"规格"等关键词下的列表
 */
function extractTechnicalRequirements(text: string): string[] {
  const reqs: string[] = []

  // 1. 匹配"技术要求：xxx"格式
  // 块结尾：两个换行 / 商务条款 / 评分 / 合同条款 / 字符串结束
  // 要求至少 1 字符内容（避免 0 字符匹配）
  const blockPattern =
    /技术[要求参数规格]+[：:]([\s\S]{1,800}?)(?=\n\s*\n|商务条款|评分|合同条款|技术[要求参数规格]+[：:]|$)/gm
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockPattern.exec(text)) !== null) {
    const block = blockMatch[1]
    if (!block.trim()) continue
    // 从块中提取条目（行号 / 顿号 / 句号分隔）
    const items = block
      .split(/[\n;；。]/)
      .map((s) => s.replace(/^[\d\.\s\-•·①②③④⑤]+/, '').trim())
      .filter((s) => s.length >= 3 && s.length <= 200)
    reqs.push(...items.slice(0, 20))
  }

  // 2. 匹配"应/须/需满足xxx"句式（允许夹杂英文/数字）
  const sentencePattern = /(?:应|须|需)[\s\S]{0,100}?(?:满足|具备|提供|支持)[\s\S]{0,100}?(?:能力|资质|条件|经验|证书|水平|功能|特性)/g
  const sentenceMatches = text.match(sentencePattern) || []
  reqs.push(...sentenceMatches.slice(0, 10).map((s) => s.replace(/\s+/g, ' ').trim()))

  return Array.from(new Set(reqs)).slice(0, 30)
}

/**
 * 提取商务条款
 * 匹配"付款方式"、"交货期"、"质保期"等
 */
function extractCommercialTerms(text: string): string[] {
  const terms: string[] = []
  const patterns = [
    /(付款方式|结算方式|付款条件)[：:]([^\n]{3,200})/g,
    /(交货期|交付时间|交付期限)[：:]([^\n]{3,100})/g,
    /(质保期|保修期|质量保证)[：:]([^\n]{3,100})/g,
    /(违约金|赔偿金)[：:]([^\n]{3,100})/g,
    /(履约保证金|投标保证金|保证金)[：:]([^\n]{3,150})/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const key = match[1]
      const value = match[2].trim()
      if (value) {
        terms.push(`${key}：${value}`)
      }
    }
  }

  return Array.from(new Set(terms)).slice(0, 20)
}

/**
 * 提取时间节点
 * 匹配"报名时间"、"开标时间"、"截止时间"等
 */
function extractTimeline(text: string): TenderTimeline[] {
  const timeline: TenderTimeline[] = []
  const events = [
    '报名时间', '报名截止',
    '招标文件发售', '文件发售',
    '踏勘现场', '标前会议',
    '开标时间', '开标',
    '投标截止', '截止时间',
    '公示时间', '中标公示',
    '合同签订', '合同生效',
  ]

  // 匹配 "事件：2024年1月1日" 或 "事件 2024-01-01"
  const datePattern = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|\d{4}[-/]\d{1,2}[-/]\d{1,2}/g

  for (const event of events) {
    const eventRegex = new RegExp(`${event}[：:为至]?\\s*([^\\n]{0,80})`, 'g')
    let match: RegExpExecArray | null
    while ((match = eventRegex.exec(text)) !== null) {
      const value = match[1]
      const dateMatch = value.match(datePattern)
      if (dateMatch) {
        timeline.push({ event, date: dateMatch[0] })
      } else {
        const fallback = value.replace(/\s+/g, ' ').trim()
        if (
          fallback.length >= 2
          && fallback.length <= 30
          && /(另行通知|待通知|详见|以.*为准|见公告|见招标文件)/.test(fallback)
        ) {
          timeline.push({ event, date: fallback })
        }
      }
    }
  }

  // 去重
  const seen = new Set<string>()
  return timeline.filter((t) => {
    const key = `${t.event}-${t.date}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 15)
}
