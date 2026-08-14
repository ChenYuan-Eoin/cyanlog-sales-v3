// REQ: F028
// PURPOSE: 多维价盘导入与数学一致性校验（纯函数，不依赖 DB）
// 口径：累计刊例价 = 上档累计 + 本档区间单账号价 × 档差；10,000+ 档无价

export interface PriceImportRow {
  product_code?: string
  product_id?: string
  version_code: string
  deployment: string
  auth_mode: string
  term_months: number | null
  currency: string
  qty_from: number
  qty_to: number | null
  unit_price: number | null   // 区间单账号刊例价（边际）
  list_price: number | null   // 累计刊例价
  sort_order: number
}

export interface PriceImportIssue {
  row: number
  field: string
  message: string
}

export interface PriceImportResult {
  ok: boolean
  checked: number
  issues: PriceImportIssue[]
}

export const CUMULATIVE_TOLERANCE = 0.01
export const NO_PRICE_MARKER = '请联系我们'

function isNoPrice(value: number | null | undefined): boolean {
  return value === null || value === undefined
}

/**
 * 校验一组价盘行（按 sheet 内同维度分组，逐档核对累计关系）。
 * 规则：
 *  1) 档位区间合法（qty_from>=1、qty_to>qty_from、无上限档最后）
 *  2) 有价档必须同时给出累计价与区间单账号价
 *  3) 累计 = 上档累计 + 本档单价 × 档差（容差 0.01）
 *  4) 无价档（如 10,000+「请联系我们」）允许两口径为空，且必须为每组的最后一档
 */
export function validatePriceRows(rows: PriceImportRow[]): PriceImportResult {
  const issues: PriceImportIssue[] = []
  const keyOf = (row: PriceImportRow) =>
    [row.product_code ?? row.product_id ?? '', row.version_code, row.deployment, row.auth_mode, row.term_months ?? '', row.currency].join('|')

  const groups = new Map<string, PriceImportRow[]>()
  rows.forEach((row, index) => {
    const key = keyOf(row)
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push({ ...row, sort_order: index })
  })

  let checked = 0
  groups.forEach((group) => {
    const sorted = [...group].sort((a, b) => a.qty_from - b.qty_from)
    let prevQty = 0       // 上一档 qty_to（初始 0）
    let prevListPrice = 0
    let prevWasNoPrice = false

    sorted.forEach((row, i) => {
      // 规则 1：区间合法
      if (row.qty_from < 1) {
        issues.push({ row: row.sort_order + 2, field: 'qty_from', message: 'qty_from 必须 >= 1' })
      }
      if (row.qty_to !== null && row.qty_to !== undefined && row.qty_to <= row.qty_from) {
        issues.push({ row: row.sort_order + 2, field: 'qty_to', message: 'qty_to 必须大于 qty_from' })
      }
      // 规则 1b：档位必须连续（首档从 1 开始）
      if (row.qty_to !== null && row.qty_to !== undefined && prevQty === 0 && row.qty_from !== 1) {
        issues.push({ row: row.sort_order + 2, field: 'qty_from', message: '首档 qty_from 必须为 1' })
      }
      if (row.qty_to !== null && row.qty_to !== undefined && prevQty > 0 && row.qty_from !== prevQty + 1) {
        issues.push({ row: row.sort_order + 2, field: 'qty_from', message: `档位不连续：期望 ${prevQty + 1}，实际 ${row.qty_from}` })
      }
      // 规则 4：无价档必须是组内最后一档（10,000+）
      const noPrice = isNoPrice(row.unit_price) && isNoPrice(row.list_price)
      if (noPrice && i < sorted.length - 1) {
        issues.push({ row: row.sort_order + 2, field: 'list_price', message: '无价档（请联系我们）必须是该维度组最后一档' })
      }
      if (prevWasNoPrice) {
        issues.push({ row: row.sort_order + 2, field: 'qty_from', message: '无价档之后不允许再出现有价档' })
      }
      prevWasNoPrice = noPrice
      if (noPrice) {
        return
      }
      // 规则 2：两口径同时给出
      if (isNoPrice(row.unit_price) !== isNoPrice(row.list_price)) {
        issues.push({ row: row.sort_order + 2, field: 'list_price', message: '累计价与区间单账号价必须同时给出或同时为空' })
      }
      if (row.unit_price === null || row.list_price === null) {
        return
      }
      // 规则 3：累计关系（累计价 = 上档累计 + 本档单价 × 档差，档差按档位上限计算）
      if (row.qty_to !== null && row.qty_to !== undefined) {
        const delta = row.qty_to - prevQty
        const expected = prevListPrice + row.unit_price * delta
        if (Math.abs(expected - row.list_price) > CUMULATIVE_TOLERANCE) {
          issues.push({
            row: row.sort_order + 2,
            field: 'list_price',
            message: `累计价不符：期望 ${expected.toFixed(2)}，实际 ${row.list_price.toFixed(2)}（上档累计 ${prevListPrice.toFixed(2)} + ${row.unit_price} × ${delta}）`,
          })
        } else {
          checked += 1
        }
        prevListPrice = row.list_price
      }
      prevQty = row.qty_to ?? row.qty_from - 1
    })
  })

  return { ok: issues.length === 0, checked, issues }
}

/** 解析 Project 价盘 dump（.tmp/price-table-dump.txt 格式：A45=私有部署 | B45=按年订阅版 | C45=10 ...） */
export function parsePriceTableDump(text: string, productCode = 'PROJECT'): PriceImportRow[] {
  const rows: PriceImportRow[] = []
  const re = /^\s*([A-Z]+)\d*=(.+)$/
  // 块上下文：A/B/E 只在每块首行出现，后续行继承（直到下一个块首行）
  const DEPLOY_MAP: Record<string, string> = { 公有云: 'PUBLIC_CLOUD', 私有部署: 'PRIVATE', 高可用部署: 'HA' }
  const AUTH_MAP: Record<string, string> = { 按年订阅版: 'SUB_YEAR', 三年订阅版: 'SUB_3YEAR', 一次性授权版: 'ONETIME' }
  let deployment = 'PUBLIC_CLOUD'
  let authMode = 'SUB_YEAR'
  let termMonths: number | null = 12

  for (const line of text.split('\n')) {
    if (!line.includes('|')) {
      continue
    }
    const cells: Record<string, string> = {}
    for (const cell of line.split('|')) {
      const m = re.exec(cell)
      if (m) {
        cells[m[1]] = m[2].trim()
      }
    }
    if (cells.A) {
      deployment = DEPLOY_MAP[cells.A] || cells.A
    }
    if (cells.B) {
      authMode = AUTH_MAP[cells.B] || cells.B
      termMonths = authMode === 'ONETIME' ? null : cells.E === '36' ? 36 : 12
    }
    if (cells.E) {
      termMonths = authMode === 'ONETIME' ? null : cells.E === '36' ? 36 : 12
    }
    if (!cells.D) {
      continue
    }
    const range = cells.D.replace(/,/g, '')
    let qtyFrom: number
    let qtyTo: number | null
    if (range.includes('+')) {
      qtyFrom = Number(range.split('+')[0].trim()) + 1
      qtyTo = null
    } else {
      const parts = range.split('-').map((x) => Number(x.trim()))
      if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
        continue
      }
      qtyFrom = parts[0]
      qtyTo = parts[1]
    }
    if (!Number.isFinite(qtyFrom) || qtyFrom === 0) {
      continue
    }
    const toNum = (v?: string): number | null => {
      if (v === undefined || v === '' || v === '/' || v === NO_PRICE_MARKER) {
        return null
      }
      const n = Number(v.replace(/,/g, ''))
      return Number.isFinite(n) ? n : null
    }
    // 版本列对：F/G 标准、H/I 专业、J/K 企业、L/M 信创
    const versions: Array<[string, string, string]> = [
      ['STD_V6', 'F', 'G'],
      ['PRO_V6', 'H', 'I'],
      ['ENT_V6', 'J', 'K'],
      ['XINCHUANG_V6', 'L', 'M'],
    ]
    for (const [versionCode, listCol, unitCol] of versions) {
      const listPrice = toNum(cells[listCol])
      const unitPrice = toNum(cells[unitCol])
      if (listPrice === null && unitPrice === null) {
        continue // 该版本此档无价（如标准版私有部署为 /）
      }
      rows.push({
        product_code: productCode,
        version_code: versionCode,
        deployment,
        auth_mode: authMode,
        term_months: termMonths,
        currency: 'CNY',
        qty_from: qtyFrom,
        qty_to: qtyTo,
        unit_price: unitPrice,
        list_price: listPrice,
        sort_order: rows.length,
      })
    }
  }
  return rows
}

