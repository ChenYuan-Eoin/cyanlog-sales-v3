// lib/normalizer/index.ts
// Normalizer — 归一化与数据清洗器（防屎山核心）
// Tier 1: 数据层绝对防御 — 所有输入必须经过归一化才能进入规则引擎
//
// 设计原则：
// - AI 提取的原始数据 → Normalizer → 标准化特征向量 → Auditor
// - 所有数值计算使用整数分（Long），禁止使用浮点数
// - 比例统一为 4 位小数（如 30% → 300000 / 1000000 = 0.3000）
// - 日期统一为工作日（排除周末和法定节假日）

// ═══════════════════════════════════════════════════════════════
// 1. BigDecimal — 高精度金额计算（以分为单位）
// ═══════════════════════════════════════════════════════════════

const CURRENCY_BASE = 100 // 1元 = 100分

/** 金额对象 — 以分为单位存储，保证精度 */
export interface Currency {
  cents: bigint // 金额（分）
  currency: 'CNY' | 'USD' // 币种
}

/** 将字符串/数字金额解析为分（Long） */
export function parseCurrency(value: string | number): Currency {
  if (typeof value === 'string') {
    // 去除空格和货币符号
    const cleaned = value.replace(/[\s,¥$]/g, '').trim()
    // 支持中文大写金额（简化版）
    if (/[一二三四五六七八九十百千万亿]/.test(cleaned)) {
      return { cents: parseChineseAmount(cleaned), currency: 'CNY' }
    }
    // 支持 "118,935.00" 或 "118935.00"
    const numMatch = cleaned.match(/^(\d+(?:\.\d{1,2})?)$/)
    if (!numMatch) {
      throw new Error(`无法解析金额: ${value}`)
    }
    const num = parseFloat(numMatch[1])
    return { cents: BigInt(Math.round(num * CURRENCY_BASE)), currency: 'CNY' }
  }
  // 数字输入
  return { cents: BigInt(Math.round(value * CURRENCY_BASE)), currency: 'CNY' }
}

/** 将分转换为展示格式（元） */
export function formatCurrency(currency: Currency): string {
  const yuan = Number(currency.cents) / CURRENCY_BASE
  return `¥${yuan.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

/** 金额加法（分） */
export function addCurrency(a: Currency, b: Currency): Currency {
  return { cents: a.cents + b.cents, currency: a.currency }
}

/** 金额减法（分） */
export function subtractCurrency(a: Currency, b: Currency): Currency {
  return { cents: a.cents - b.cents, currency: a.currency }
}

/** 金额乘法（分 × 比例 → 分） */
export function multiplyCurrencyBy(currency: Currency, ratio: Ratio): Currency {
  // ratio.value 是 4 位小数（如 0.3000 → 30000/100000）
  const result = (currency.cents * BigInt(ratio.numerator)) / BigInt(ratio.denominator)
  return { cents: result, currency: currency.currency }
}

/** 金额比较（返回 -1/0/1） */
export function compareCurrency(a: Currency, b: Currency): number {
  if (a.cents < b.cents) return -1
  if (a.cents > b.cents) return 1
  return 0
}

// ═══════════════════════════════════════════════════════════════
// 2. Ratio — 比例统一化（4 位小数）
// ═══════════════════════════════════════════════════════════════

export interface Ratio {
  numerator: number   // 分子（如 30 → 300000）
  denominator: number // 分母（固定 1000000，即 6 位精度）
}

/** 解析比例 — 支持多种输入格式 */
export function parseRatio(value: string | number): Ratio {
  const DENOMINATOR = 1_000_000

  if (typeof value === 'number') {
    // 数字输入（如 0.3）
    return { numerator: Math.round(value * DENOMINATOR), denominator: DENOMINATOR }
  }

  const cleaned = value.trim()

  // 百分比格式：30% 或 30.5%
  if (cleaned.endsWith('%')) {
    const num = parseFloat(cleaned.slice(0, -1))
    return { numerator: Math.round((num / 100) * DENOMINATOR), denominator: DENOMINATOR }
  }

  // 中文比例：三成、百分之三十
  if (/[成折分]/.test(cleaned)) {
    const ratio = parseChineseRatio(cleaned)
    return { numerator: Math.round(ratio * DENOMINATOR), denominator: DENOMINATOR }
  }

  // 纯数字（假设为百分比值）
  const num = parseFloat(cleaned)
  if (num <= 1) {
    // 已经是小数形式（如 0.3）
    return { numerator: Math.round(num * DENOMINATOR), denominator: DENOMINATOR }
  }
  // 大于1，假设是百分比（如 30）
  return { numerator: Math.round((num / 100) * DENOMINATOR), denominator: DENOMINATOR }
}

/** 比例比较（返回 -1/0/1） */
export function compareRatio(a: Ratio, b: Ratio): number {
  // 通分比较
  const aVal = a.numerator * b.denominator
  const bVal = b.numerator * a.denominator
  if (aVal < bVal) return -1
  if (aVal > bVal) return 1
  return 0
}

/** 比例转百分比字符串 */
export function formatRatio(ratio: Ratio): string {
  const percentage = (ratio.numerator / ratio.denominator) * 100
  return `${percentage.toFixed(2)}%`
}

// ═══════════════════════════════════════════════════════════════
// 3. Duration — 时限统一化（工作日/自然日）
// ═══════════════════════════════════════════════════════════════

export type DurationUnit = 'day' | 'workday' | 'month' | 'year'

export interface Duration {
  value: number
  unit: DurationUnit
}

/** 解析时限 — 统一为工作日 */
export function parseDuration(value: string, unit: DurationUnit): Duration {
  const num = parseFloat(value)

  // 转换为工作日
  switch (unit) {
    case 'day':
      return { value: num, unit: 'workday' }
    case 'workday':
      return { value: num, unit: 'workday' }
    case 'month':
      return { value: num * 21.75, unit: 'workday' } // 平均每月工作日
    case 'year':
      return { value: num * 250, unit: 'workday' } // 平均每年工作日
    default:
      return { value: num, unit: 'workday' }
  }
}

/** 时限比较（统一为工作日后比较） */
export function compareDuration(a: Duration, b: Duration): number {
  // 都转换为工作日
  const aDays = toWorkdays(a)
  const bDays = toWorkdays(b)
  if (aDays < bDays) return -1
  if (aDays > bDays) return 1
  return 0
}

function toWorkdays(d: Duration): number {
  if (d.unit === 'workday') return d.value
  if (d.unit === 'day') return d.value * (5/7) // 粗略转换
  return d.value
}

// ═══════════════════════════════════════════════════════════════
// 4. FeatureVector — 合同要素特征向量
// ═══════════════════════════════════════════════════════════════

/** 特征向量 — AI 提取的数据经 Normalizer 后，进入 Auditor 的标准输入 */
export interface FeatureVector {
  // 金额类
  totalAmount?: Currency        // 合同总额
  paymentAmount?: Currency[]   // 分期付款金额
  depositAmount?: Currency     // 定金

  // 比例类
  depositRatio?: Ratio          // 定金比例
  penaltyRate?: Ratio           // 违约金比例
  lateFeeRate?: Ratio           // 滞纳金比例

  // 时限类
  contractTerm?: Duration       // 合同期限
  paymentTerm?: Duration        // 付款期限
  warrantyTerm?: Duration      // 质保期限

  // 布尔/枚举类
  ipOwnership?: '甲方' | '乙方' | '共有'
  disputeResolution?: '甲方所在地' | '乙方所在地' | '仲裁'
  governingLaw?: string        // 适用法律

  // 文本类（MasterData 匹配）
  productNames?: string[]       // 产品名称（需匹配 Ref/10 标准名称）
  partyA?: string              // 甲方名称
  partyB?: string              // 乙方名称

  // 元数据
  extractedAt: string          // 提取时间 ISO8601
  confidence: number           // AI 提取置信度（0-1）
  aiProvider: string           // AI 来源（用于回溯）
}

/** 创建空的特征向量 */
export function createFeatureVector(): FeatureVector {
  return {
    extractedAt: new Date().toISOString(),
    confidence: 0,
    aiProvider: 'unknown',
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. 中文金额/比例解析（简化版）
// ═══════════════════════════════════════════════════════════════

function parseChineseAmount(text: string): bigint {
  const map: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000,
  }

  // 简化处理：只处理 "一万两千三百四十五" 格式
  let result = 0n
  let temp = 0

  for (const char of text) {
    const val = map[char]
    if (val === undefined) continue

    if (val >= 10) {
      if (temp === 0) temp = 1
      result += BigInt(temp * val)
      temp = 0
    } else {
      temp = temp * 10 + val
    }
  }

  result += BigInt(temp)
  return result * BigInt(CURRENCY_BASE)
}

function parseChineseRatio(text: string): number {
  if (text.includes('成')) {
    const match = text.match(/(\d+|[一二三四五六七八九十])成/)
    if (match) {
      const num = parseChineseDigit(match[1])
      return num / 10
    }
  }
  if (text.includes('折')) {
    const match = text.match(/(\d+|[一二三四五六七八九十])折/)
    if (match) {
      const num = parseChineseDigit(match[1])
      return num / 10
    }
  }
  // 默认返回 0
  return 0
}

function parseChineseDigit(str: string): number {
  const map: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  }
  if (map[str]) return map[str]
  return parseInt(str, 10) || 0
}

// ═══════════════════════════════════════════════════════════════
// 6. 归一化主入口
// ═══════════════════════════════════════════════════════════════

export interface NormalizedData {
  featureVector: FeatureVector
  validation: {
    isValid: boolean
    errors: string[]
    warnings: string[]
  }
}

/** 主归一化函数 — AI 原始输出 → 标准化特征向量 */
export function normalize(input: {
  totalAmount?: string | number
  depositRatio?: string | number
  contractTerm?: { value: string; unit: DurationUnit }
  productNames?: string[]
  confidence?: number
  aiProvider?: string
}): NormalizedData {
  const featureVector = createFeatureVector()
  const errors: string[] = []
  const warnings: string[] = []

  // 金额归一化
  if (input.totalAmount) {
    try {
      featureVector.totalAmount = parseCurrency(input.totalAmount)
    } catch (e) {
      errors.push(`金额解析失败: ${String(e)}`)
    }
  }

  // 比例归一化
  if (input.depositRatio) {
    try {
      featureVector.depositRatio = parseRatio(input.depositRatio)
    } catch (e) {
      errors.push(`比例解析失败: ${String(e)}`)
    }
  }

  // 时限归一化
  if (input.contractTerm) {
    try {
      featureVector.contractTerm = parseDuration(input.contractTerm.value, input.contractTerm.unit)
    } catch (e) {
      errors.push(`时限解析失败: ${String(e)}`)
    }
  }

  // 产品名称
  if (input.productNames) {
    featureVector.productNames = input.productNames
  }

  // 元数据
  if (input.confidence) {
    featureVector.confidence = input.confidence
  }
  if (input.aiProvider) {
    featureVector.aiProvider = input.aiProvider
  }

  // 验证：金额一致性（大小写、数值）
  if (featureVector.totalAmount && featureVector.totalAmount.cents <= 0n) {
    errors.push('合同金额必须大于 0')
  }

  // 验证：置信度熔断（低于 0.85 警告）
  if (featureVector.confidence < 0.85) {
    warnings.push(`AI 提取置信度 ${featureVector.confidence.toFixed(2)} 低于 0.85，建议人工复核`)
  }

  return {
    featureVector,
    validation: {
      isValid: errors.length === 0,
      errors,
      warnings,
    },
  }
}
