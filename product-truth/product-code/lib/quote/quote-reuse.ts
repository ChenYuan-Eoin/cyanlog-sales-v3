// REQ: WP10 阶段2
// PURPOSE: 报价复制/复用的继承语义（纯函数，route 调用）
// 原则：复制=继承业务事实（客户/区域/明细行/版本/部署/授权/数量），
//      价格不直接继承——历史价作为参照（list_price），成交价重新计算；
//      审批/状态/折扣原因不继承（新单从 DRAFT 开始，留痕后可追溯）

export interface ReuseSourceItem {
  product_id?: string | null
  product_type?: string | null
  product_code?: string | null
  name?: string | null
  specification?: string | null
  unit?: string | null
  quantity?: number | null
  unit_price?: number | null
  list_price?: number | null
  line_total?: number | null
  tier_range?: string | null
  version_code?: string | null
  deployment?: string | null
  auth_mode?: string | null
  term_months?: number | null
  is_gift?: boolean | null
  gift_original_amount?: number | null
  tax_rate?: number | null
  maintenance_months?: number | null
  version_from?: string | null
  version_to?: string | null
  line_type?: string | null
  line_note?: string | null
  region?: string | null
  cost_price?: number | null
  floor_price?: number | null
}

export interface ReusedItem {
  product_id: string | null
  product_type: string
  product_code: string | null
  name: string
  specification: string | null
  unit: string | null
  quantity: number
  unit_price: number
  list_price: number | null
  line_total: number
  discount: number
  tier_range: string | null
  version_code: string | null
  deployment: string | null
  auth_mode: string | null
  term_months: number | null
  is_gift: boolean
  gift_original_amount: number | null
  tax_rate: number | null
  maintenance_months: number | null
  version_from: string | null
  version_to: string | null
  line_type: string
  line_note: string | null
  region: string | null
  cost_price: number | null
  floor_price: number | null
  pricing_source: 'manual'
}

/**
 * 明细继承语义：
 *  - 业务事实（产品/版本/部署/授权/期限/数量/行类型/说明）继承
 *  - 历史价只作为 list_price 参照，unit_price=0 / line_total=0（重新算价）
 *  - 折扣/赠送/起止日期/成本毛利重置（新单重新决策）
 */
export function buildReusedQuoteItem(item: ReuseSourceItem, defaultRegion: string | null): ReusedItem {
  return {
    product_id: item.product_id ?? null,
    product_type: item.product_type ?? 'sku',
    product_code: item.product_code ?? null,
    name: item.name ?? '',
    specification: item.specification ?? null,
    unit: item.unit ?? null,
    quantity: item.quantity ?? 1,
    unit_price: 0,
    list_price: item.list_price ?? item.line_total ?? null,
    line_total: 0,
    discount: 0,
    tier_range: item.tier_range ?? null,
    version_code: item.version_code ?? null,
    deployment: item.deployment ?? null,
    auth_mode: item.auth_mode ?? null,
    term_months: item.term_months ?? null,
    is_gift: false,
    gift_original_amount: null,
    tax_rate: item.tax_rate ?? null,
    maintenance_months: item.maintenance_months ?? null,
    version_from: item.version_from ?? null,
    version_to: item.version_to ?? null,
    line_type: item.line_type ?? 'product',
    line_note: item.line_note ?? null,
    region: item.region ?? defaultRegion,
    // 成本/底价不继承旧值：新单由服务端从当前产品目录重新带出（内部核算保持真实）
    cost_price: null,
    floor_price: null,
    pricing_source: 'manual',
  }
}
