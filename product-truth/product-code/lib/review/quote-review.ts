// REQ: F047（报价审核自动化）
// PURPOSE: 把人工审核 Checklist 变成自动核验：提交审批时逐项检查，
// BLOCK 项不满足 → 暂缓审批；WARN 项 → 审核视图提醒。
import { numberToChineseUpper, validateProductCombination, type QuoteLineInput } from '@/lib/pricing/quote-builder'

export type ReviewLevel = 'block' | 'warn' | 'pass'

export interface ReviewCheck {
  code: string
  label: string
  level: ReviewLevel
  ok: boolean
  message?: string
  line?: number
}

export interface QuoteReviewItemInput {
  id?: string
  product_id?: string | null
  product_code?: string | null
  name?: string | null
  version_code?: string | null
  deployment?: string | null
  auth_mode?: string | null
  term_months?: number | null
  quantity?: number | null
  unit_price?: number | null
  list_price?: number | null
  discount?: number | null
  line_total?: number | null
  line_type?: string | null
  discount_reason?: string | null
  line_note?: string | null
  subscription_start?: string | null
  subscription_end?: string | null
  is_gift?: boolean | null
  gift_original_amount?: number | null
  maintenance_months?: number | null
  version_from?: string | null
  version_to?: string | null
  tax_rate?: number | null
  cost_price?: number | null
  floor_price?: number | null
  line_cost?: number | null
  margin_rate?: number | null
  region?: string | null
  attributes?: Record<string, unknown> | null
}

export interface QuoteReviewInput {
  discountMaxPercent?: number
  /** F048/F051 阈值参数：由业务参数解析传入，缺失时输出 WARN 而非默认值 */
  deepDiscountRatio?: number   // 成交价低于刊例价此比例 → 超底价审批（业务参数 DISCOUNT_DEEP_RATIO，默认 0.5 由配置中心提供）
  heavyDiscountRatio?: number  // 低于此比例 → 大额折扣审批（DISCOUNT_HEAVY_RATIO，默认 0.8）
  marginFloorRatio?: number    // 毛利率底线（MARGIN_FLOOR_RATIO，默认 0.3）
  maintenanceRate?: number     // 维保费率（MAINT_RATE，默认 0.2）
  userRoleCodes?: string[]
  discountPolicies?: Record<string, { maxDiscount: number; hardCap: number | null }>
  quote: {
    customer_name?: string | null
    currency?: string | null
    tax_inclusive?: boolean | null
    valid_until?: string | null
    discount_rate?: number | null
    discount_reason?: string | null
    quote_kind?: string | null
    change_reason?: string | null
    status?: string | null
    notes?: string | null
    subtotal?: number | null
    discount_amount?: number | null
    tax_amount?: number | null
    total_amount?: number | null
    amount_in_words?: string | null
    total_cost?: number | null
    margin_rate?: number | null
    region?: string | null
    attributes?: Record<string, unknown> | null
  }
  items: QuoteReviewItemInput[]
  versions?: Array<{ version_code: string; deployments?: string[]; auth_modes?: string[]; status?: string }>
  products?: Record<string, { code: string; attributes?: { category?: string; follows?: string[]; version_codes?: string[]; quantityLinkedTo?: string; taxCategory?: string } }>
}

export interface QuoteReviewResult {
  status: 'PASS' | 'WARN' | 'BLOCK'
  checks: ReviewCheck[]
  blocked: ReviewCheck[]
  warnings: ReviewCheck[]
}

const LINE_TYPES = new Set(['product', 'service', 'dev', 'maintenance', 'gift', 'other'])
const PLACEHOLDER_NAMES = ['测试', '验收', 'E2E', 'demo', 'Demo', 'TEST', '客户1', '客户2', '张三', '无', 'test']

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function reviewQuote(input: QuoteReviewInput, now = new Date()): QuoteReviewResult {
  const { quote, items = [], versions = [], products = {} } = input
  const checks: ReviewCheck[] = []
  const push = (check: ReviewCheck) => checks.push(check)
  const pct = (value?: number | null) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

  // R01 抬头真实
  const name = (quote.customer_name || '').trim()
  const nameBad = name.length === 0 || PLACEHOLDER_NAMES.some((w) => name.includes(w))
  push({ code: 'HEADER_REAL', label: '报价抬头真实（工商名称）', level: 'block', ok: !nameBad, message: nameBad ? (name ? `抬头含占位/测试词：${name}` : '抬头为空') : name })

  // R02 行完整性
  items.forEach((item, i) => {
    const missing: string[] = []
    if (!item.product_id) missing.push('产品')
    if (!item.version_code) missing.push('版本')
    if (!item.deployment) missing.push('部署')
    if (!item.auth_mode) missing.push('授权')
    if (missing.length > 0) {
      push({ code: 'LINE_COMPLETE', label: `第${i + 1}行 产品/版本/部署/授权明确`, level: 'block', ok: false, message: `缺少：${missing.join('/')}`, line: i + 1 })
    } else {
      push({ code: 'LINE_COMPLETE', label: `第${i + 1}行 产品/版本/部署/授权明确`, level: 'block', ok: true, line: i + 1 })
    }
  })

  // R03 币种
  push({ code: 'CURRENCY', label: '币种明确', level: 'block', ok: !!quote.currency, message: quote.currency ? `币种 ${quote.currency}` : '缺少币种' })

  // R03b 区域一致（F049）
  const quoteRegion = (quote.region || 'CN').toUpperCase()
  const regionMismatch = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.region && it.region.toUpperCase() !== quoteRegion)
  push({
    code: 'REGION_CONSISTENCY', label: '报价区域与分项区域一致', level: 'block',
    ok: regionMismatch.length === 0,
    message: regionMismatch.length ? `第 ${regionMismatch.map(({ i }) => i + 1).join(',')} 行区域与报价区域(${quoteRegion})不一致` : `报价区域 ${quoteRegion}`,
  })

  // R04 税价口径
  push({ code: 'TAX_BASIS', label: '含税/不含税口径明确', level: 'block', ok: quote.tax_inclusive !== null && quote.tax_inclusive !== undefined, message: quote.tax_inclusive === true ? '含税口径' : '不含税口径' })

  // R05 计算一致（行/小计/总额）
  let calcOk = true
  let subtotal = 0
  items.forEach((item, i) => {
    const qty = pct(item.quantity)
    const unit = pct(item.unit_price)
    const lineTotal = pct(item.line_total)
    const lineDiscount = pct(item.discount)
    // F050：行折扣后 数量×单价-行折扣=小计
    const expected = round2(qty * unit - lineDiscount)
    if (round2(lineTotal) !== expected) {
      calcOk = false
      push({ code: 'CALC_ACCURATE', label: `第${i + 1}行 数量×单价-行折扣=小计`, level: 'block', ok: false, message: `${qty}×${unit}${lineDiscount > 0 ? `-行折扣${lineDiscount}` : ''}=${expected}，实际小计 ${lineTotal}`, line: i + 1 })
    }
    subtotal += lineTotal
  })
  if (round2(subtotal) !== round2(pct(quote.subtotal))) {
    calcOk = false
    push({ code: 'CALC_ACCURATE', label: '产品小计汇总', level: 'block', ok: false, message: `行小计之和 ${round2(subtotal)} ≠ 报价小计 ${pct(quote.subtotal)}` })
  }
  const expectedTotal = round2(pct(quote.subtotal) - pct(quote.discount_amount) + pct(quote.tax_amount))
  if (round2(pct(quote.total_amount)) !== expectedTotal) {
    calcOk = false
    push({ code: 'CALC_ACCURATE', label: '报价总额计算关系', level: 'block', ok: false, message: `小计-折扣+税=${expectedTotal}，实际总额 ${pct(quote.total_amount)}` })
  }
  if (calcOk) {
    push({ code: 'CALC_ACCURATE', label: '分项/小计/总额计算准确', level: 'block', ok: true })
  }

  // R06 大写金额一致
  const total = pct(quote.total_amount)
  const upper = quote.amount_in_words
  if (upper) {
    const expectedUpper = numberToChineseUpper(total)
    push({ code: 'AMOUNT_IN_WORDS', label: '金额大写正确', level: 'block', ok: expectedUpper === upper, message: expectedUpper === upper ? upper : `大写 ${upper} 与金额 ${total} 不符（应为 ${expectedUpper}）` })
  } else {
    push({ code: 'AMOUNT_IN_WORDS', label: '金额大写已生成', level: 'warn', ok: false, message: '尚未生成大写金额' })
  }

  // R07 可售版本 + 部署/授权范围
  const versionMap = new Map(versions.map((v) => [v.version_code, v]))
  items.forEach((item, i) => {
    if (!item.version_code) return
    const ver = versionMap.get(item.version_code)
    if (!ver || (ver.status && ver.status !== 'PUBLISHED')) {
      push({ code: 'VERSION_SELLABLE', label: `第${i + 1}行 版本可售`, level: 'block', ok: false, message: `版本 ${item.version_code} 不在可售目录`, line: i + 1 })
      return
    }
    const depOk = !item.deployment || !ver.deployments || ver.deployments.length === 0 || ver.deployments.includes(item.deployment)
    const authOk = !item.auth_mode || !ver.auth_modes || ver.auth_modes.length === 0 || ver.auth_modes.includes(item.auth_mode)
    push({
      code: 'VERSION_SELLABLE', label: `第${i + 1}行 版本可售（${item.version_code}）`, level: 'block',
      ok: depOk && authOk,
      message: depOk && authOk ? undefined : `版本 ${item.version_code} 不允许 部署=${item.deployment} 授权=${item.auth_mode}`,
      line: i + 1,
    })
  })

  // R08 分项边界 + 税率
  items.forEach((item, i) => {
    const lt = item.line_type || 'product'
    const typeOk = LINE_TYPES.has(lt)
    const taxOk = item.tax_rate !== null && item.tax_rate !== undefined
    push({
      code: 'LINE_TYPE_BOUNDARY', label: `第${i + 1}行 分项边界与税率`, level: 'block',
      ok: typeOk && taxOk,
      message: !typeOk ? `行类型 ${lt} 非法` : !taxOk ? `行 ${lt} 缺少税率` : lt,
      line: i + 1,
    })
  })

  // R09 私有化必须维保
  const hasPrivate = items.some((it) => it.deployment === 'PRIVATE')
  if (hasPrivate) {
    const hasMaintLine = items.some((it) => it.line_type === 'maintenance')
    const hasMaintMonths = items.some((it) => it.deployment === 'PRIVATE' && pct(it.maintenance_months) > 0)
    push({ code: 'PRIVATE_MAINT', label: '私有化新签必须明确维保安排', level: 'block', ok: hasMaintLine || hasMaintMonths, message: hasMaintLine || hasMaintMonths ? '已含维保' : '私有化部署缺少维保行/维保月数' })
    // R09b 维保金额合理性：维保行金额 ≈ 软件小计 × 维保费率（口径一致；容差 ±15%）
    if (hasMaintLine) {
      const softwareSubtotal = items
        .filter((it) => (it.line_type === 'product' || !it.line_type) && !it.is_gift)
        .reduce((sum, it) => sum + pct(it.line_total), 0)
      const maintTotal = items
        .filter((it) => it.line_type === 'maintenance')
        .reduce((sum, it) => sum + pct(it.line_total), 0)
      const maintRate = input.maintenanceRate ?? 0.2
      const expected = softwareSubtotal * maintRate
      if (expected > 0 && (maintTotal < expected * 0.85 || maintTotal > expected * 1.15)) {
        push({ code: 'MAINT_AMOUNT', label: '维保金额与软件小计×费率一致', level: 'warn', ok: false, message: `维保金额 ${maintTotal} 与预期 ${Math.round(expected)}（软件 ${softwareSubtotal} × ${(maintRate * 100).toFixed(0)}%）偏差超 15%` })
      }
    }
  }

  // R10 订阅明确起止日期
  const hasSub = items.some((it) => (it.auth_mode || '').startsWith('SUB_'))
  if (hasSub) {
    const bad = items.filter((it) => (it.auth_mode || '').startsWith('SUB_') && (!it.subscription_start || !it.subscription_end))
    push({ code: 'SUBSCRIBE_DATE', label: '订阅制必须明确起止日期', level: 'block', ok: bad.length === 0, message: bad.length ? `有 ${bad.length} 行订阅缺少起止日期` : '订阅起止日期已填' })
  }

  // R11 折扣原因（报价级或行级）
  const hasDiscount = pct(quote.discount_rate) > 0 || items.some((it) => pct(it.discount) > 0 || (pct(it.list_price) > 0 && pct(it.line_total) < pct(it.list_price)))
  if (hasDiscount) {
    const qReason = (quote.discount_reason || '').trim()
    const lineMissing = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => (pct(it.discount) > 0 || (pct(it.list_price) > 0 && pct(it.line_total) < pct(it.list_price))) && !(it.discount_reason || '').trim())
    const needQuoteReason = pct(quote.discount_rate) > 0 && !qReason
    push({
      code: 'DISCOUNT_REASON', label: '折扣必须说明原因（为什么这样报价）', level: 'block',
      ok: !needQuoteReason && lineMissing.length === 0,
      message: qReason ? `报价折扣原因：${qReason}` : needQuoteReason ? '报价级折扣缺少原因' : lineMissing.length ? `第 ${lineMissing.map(({ i }) => i + 1).join(',')} 行有折扣但缺原因` : '折扣原因已填',
    })
  }

  // R11b 折扣上限（F050/F051）：超过常规上限需审批；超过角色硬顶阻断
  // 阈值必须由业务参数解析传入；未配置时不默认 40%，输出 WARN 提示
  const rolePolicy = (input.userRoleCodes || [])
    .map((code) => input.discountPolicies?.[code])
    .find((p) => !!p && p.maxDiscount > 0)
  const hardCapPercent = rolePolicy?.hardCap != null ? rolePolicy.hardCap * 100 : null
  const quoteDiscountPct = pct(quote.discount_rate) * 100
  const lineDiscountPct = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => pct(it.discount) > 0)
    .map(({ it, i }) => ({ pct: pct(it.discount) / Math.max(pct(it.quantity) * pct(it.unit_price), 1) * 100, i }))
  const maxLinePct = Math.max(0, ...lineDiscountPct.map((x) => x.pct))
  const maxAppliedPct = Math.max(quoteDiscountPct, maxLinePct)
  const overHard = hardCapPercent != null && maxAppliedPct > hardCapPercent
  if (input.discountMaxPercent == null && !rolePolicy) {
    push({ code: 'DISCOUNT_POLICY', label: '折扣上限已配置（DISCOUNT_MAX/角色折扣策略）', level: 'warn', ok: false, message: '未配置常规折扣上限或角色折扣策略，无法核验折扣权限' })
  } else {
    const maxPercent = rolePolicy ? rolePolicy.maxDiscount * 100 : input.discountMaxPercent!
    const overMax = maxAppliedPct > maxPercent
    if (overHard) {
      push({ code: 'DISCOUNT_POLICY', label: `折扣不超过角色硬顶（${hardCapPercent}%）`, level: 'block', ok: false, message: `折扣 ${maxAppliedPct.toFixed(1)}% 超过硬顶 ${hardCapPercent}%，阻断` })
    } else if (overMax) {
      push({ code: 'DISCOUNT_POLICY', label: `折扣不超过常规上限（${maxPercent}%）`, level: 'warn', ok: false, message: `折扣 ${maxAppliedPct.toFixed(1)}% 超过常规上限 ${maxPercent}%，需审批确认` })
    } else {
      push({ code: 'DISCOUNT_POLICY', label: `折扣不超过常规上限（${maxPercent}%）`, level: 'block', ok: true, message: `折扣在常规上限 ${maxPercent}% 内` })
    }
  }

  // R12 搭售/售卖规则（组合校验）
  const comboInputs: QuoteLineInput[] = items
    .map((item, i) => {
      const prod = item.product_id ? products[item.product_id] : undefined
      const attrs = prod?.attributes
      return {
        productId: item.product_id || `line-${i}`,
        productCode: item.product_code || prod?.code || item.name || `P${i}`,
        category: (attrs?.category as QuoteLineInput['category']) || 'BASE',
        follows: attrs?.follows || [],
        quantityLinkedTo: typeof attrs?.quantityLinkedTo === 'string' ? attrs.quantityLinkedTo : undefined,
        taxCategory: attrs?.taxCategory === 'service' ? 'service' : 'software',
        versionCode: item.version_code || '',
        deployment: item.deployment || '',
        authMode: item.auth_mode || '',
        termMonths: item.term_months ?? null,
        quantity: pct(item.quantity),
        isGift: !!item.is_gift,
      }
    })
  if (comboInputs.length > 0) {
    const issues = validateProductCombination(comboInputs)
    push({
      code: 'COMBINATION_RULE', label: '符合售卖规则（搭售/跟随/版本部署一致）', level: 'block',
      ok: issues.length === 0,
      message: issues.length ? issues.map((x) => x.message).join('；') : '组合校验通过',
    })
  }

  // R13 折扣治理（阈值来自业务参数，缺失时 WARN 提示配置缺失）
  const deepRatio = input.deepDiscountRatio ?? 0.5
  const heavyRatio = input.heavyDiscountRatio ?? 0.8
  const deepConfigured = input.deepDiscountRatio != null
  const heavyConfigured = input.heavyDiscountRatio != null
  const deepDiscounts = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => pct(it.list_price) > 0 && pct(it.line_total) > 0 && pct(it.line_total) < pct(it.list_price) * deepRatio)
  const heavyDiscounts = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => pct(it.list_price) > 0 && pct(it.line_total) > 0 && pct(it.line_total) < pct(it.list_price) * heavyRatio)
  if (deepDiscounts.length) {
    push({ code: 'DISCOUNT_GOVERNANCE', label: '成交价不得低于底价', level: 'block', ok: false, message: `第 ${deepDiscounts.map(({ i }) => i + 1).join(',')} 行小计低于刊例价 ${(deepRatio * 100).toFixed(0)}%，需底价审批` })
  } else if (heavyDiscounts.length) {
    push({ code: 'DISCOUNT_GOVERNANCE', label: '大额折扣需审批确认', level: 'warn', ok: false, message: `第 ${heavyDiscounts.map(({ i }) => i + 1).join(',')} 行小计低于刊例价 ${(heavyRatio * 100).toFixed(0)}%，审批视图需展示原价/成交价` })
  } else if (!deepConfigured || !heavyConfigured) {
    push({ code: 'DISCOUNT_GOVERNANCE', label: '底价/大额折扣阈值已配置（DISCOUNT_DEEP/HEAVY_RATIO）', level: 'warn', ok: false, message: '未配置底价/大额折扣阈值，折扣治理按默认 50%/80% 提示' })
  } else {
    push({ code: 'DISCOUNT_GOVERNANCE', label: '折扣在原价/底价范围内', level: 'block', ok: true })
  }

  // R13b 毛利底线（F048）：缺成本→提醒；低于成本→硬阻断；低于毛利底线→需审批
  const totalCost = pct(quote.total_cost)
  const quoteMargin = quote.margin_rate !== null && quote.margin_rate !== undefined ? Number(quote.margin_rate) : null
  const itemHasCost = items.some((it) => pct(it.cost_price) > 0 || pct(it.line_cost) > 0)
  if (totalCost <= 0 && !itemHasCost) {
    push({ code: 'MARGIN_FLOOR', label: '毛利可核验（成本/底价已维护）', level: 'warn', ok: false, message: '缺少成本数据，无法核验毛利，请在配置中心维护产品成本价' })
  } else if (quoteMargin !== null && quoteMargin < 0) {
    push({ code: 'MARGIN_FLOOR', label: '成交价不得低于成本（毛利底线）', level: 'block', ok: false, message: `整单毛利率 ${(quoteMargin * 100).toFixed(1)}%，低于成本，硬阻断` })
  } else if (quoteMargin !== null && input.marginFloorRatio != null && quoteMargin < input.marginFloorRatio) {
    push({ code: 'MARGIN_FLOOR', label: `毛利率不低于底线（${(input.marginFloorRatio * 100).toFixed(0)}%）`, level: 'warn', ok: false, message: `整单毛利率 ${(quoteMargin * 100).toFixed(1)}%，低于毛利底线 ${(input.marginFloorRatio * 100).toFixed(0)}%，需审批确认` })
  } else if (quoteMargin !== null && input.marginFloorRatio == null) {
    push({ code: 'MARGIN_FLOOR', label: '毛利底线已配置（MARGIN_FLOOR_RATIO）', level: 'warn', ok: false, message: `未配置毛利底线，当前毛利率 ${(quoteMargin * 100).toFixed(1)}% 无法按底线核验` })
  } else {
    push({ code: 'MARGIN_FLOOR', label: '毛利在底线以上', level: 'block', ok: true, message: quoteMargin !== null ? `整单毛利率 ${(quoteMargin * 100).toFixed(1)}%` : '毛利核验通过' })
  }

  // R14 有效期
  const rawValidUntil = quote.valid_until || ''
  const validUntil = rawValidUntil ? new Date(rawValidUntil.includes('T') ? rawValidUntil : `${rawValidUntil}T23:59:59`) : null
  const expired = !validUntil || Number.isNaN(validUntil.getTime()) || validUntil < now
  push({ code: 'VALID_UNTIL', label: '报价在有效期内', level: 'block', ok: !expired, message: expired ? (quote.valid_until ? `有效期 ${quote.valid_until} 已过期或缺失` : '缺少有效期') : `有效期至 ${quote.valid_until}` })

  // R15 场景规则组
  const kind = (quote.quote_kind || 'STANDARD').toUpperCase()
  checks.push(...sceneRules(kind, quote, items, pct))

  const blocked = checks.filter((c) => !c.ok && c.level === 'block')
  const warnings = checks.filter((c) => !c.ok && c.level === 'warn')
  const status: QuoteReviewResult['status'] = blocked.length ? 'BLOCK' : warnings.length ? 'WARN' : 'PASS'
  return { status, checks, blocked, warnings }
}

function sceneRules(
  kind: string,
  quote: QuoteReviewInput['quote'],
  items: QuoteReviewItemInput[],
  pct: (v?: number | null) => number
): ReviewCheck[] {
  const out: ReviewCheck[] = []
  const needText = (code: string, label: string, value: string | undefined | null): ReviewCheck => ({
    code, label, level: 'block' as const, ok: !!value?.trim(), message: value?.trim() ? value.trim() : `${label}：必填缺失`,
  })
  switch (kind) {
    case 'RENEW':
      out.push(needText('SCENE_RENEW', '续费须说明续费基数（原合同产品/版本/数量/维保比例）', quote.change_reason || quote.notes))
      break
    case 'ADDON':
      out.push(needText('SCENE_ADDON', '增购须说明与既有产品/合同的关系', quote.change_reason || items.map((i) => i.line_note || '').join('')))
      break
    case 'UPGRADE': {
      const hasVer = items.some((it) => (it.version_from || '').trim() || (it.version_to || '').trim())
      out.push({ code: 'SCENE_UPGRADE', label: '升级须明确原版本/新版本', level: 'block', ok: hasVer, message: hasVer ? '升级版本已填' : '升级缺少 version_from/version_to' })
      break
    }
    case 'DEV': {
      const missingIdx = items.map((it, i) => (it.line_type === 'dev' && !(it.line_note || '').trim() ? i + 1 : -1)).filter((i) => i > 0)
      out.push({ code: 'SCENE_DEV', label: '二开须说明内容/工作量/交付成果/验收/边界', level: 'block', ok: missingIdx.length === 0, message: missingIdx.length ? `第 ${missingIdx.join(',')} 行二开缺说明` : '二开说明已填' })
      break
    }
    case 'SERVICE': {
      const svc = items.filter((it) => it.line_type === 'service' && !(it.line_note || '').trim())
      out.push({ code: 'SCENE_SERVICE', label: '实施服务须说明模块/人天/单价/交付范围/期限', level: 'block', ok: svc.length === 0, message: svc.length ? '存在实施服务行缺少说明' : '实施说明已填' })
      break
    }
    case 'GIFT': {
      const bad = items.filter((it) => it.is_gift && (!pct(it.gift_original_amount) || !(it.line_note || '').trim()))
      out.push({ code: 'SCENE_GIFT', label: '赠送须有标准价值与赠送原因', level: 'block', ok: bad.length === 0, message: bad.length ? '赠送行缺少标准价值或赠送原因' : '赠送信息已填' })
      break
    }
    case 'SPECIAL_DISCOUNT':
      out.push(needText('SCENE_SPECIAL_DISCOUNT', '特殊折扣须说明原因与审批依据', quote.discount_reason))
      break
    case 'INSTALLMENT': {
      const plan = quote.attributes?.payment_plan as Array<{ ratio?: number; amount?: number }> | undefined
      const sum = Array.isArray(plan) ? plan.reduce((s, p) => s + (p.ratio ?? 0), 0) : 0
      out.push({ code: 'SCENE_INSTALLMENT', label: '分期须明确每期金额/比例且合计 100%', level: 'block', ok: Array.isArray(plan) && Math.abs(sum - 100) < 0.01, message: Array.isArray(plan) ? `分期比例合计 ${sum}%` : '缺少分期计划' })
      break
    }
    case 'CHANGE':
      out.push(needText('SCENE_CHANGE', '报价变更须说明变更原因', quote.change_reason))
      break
    default:
      break
  }
  return out
}
