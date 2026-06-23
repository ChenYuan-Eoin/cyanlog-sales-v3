# F001 API 合约

> REQ: F001 价盘与阶梯价
> 生成时间: 2026-06-11

---

## 资源模型

### Product (SKU)
```typescript
interface Product {
  id: string                    // UUID
  org_id: string               // 组织ID（隔离）
  code: string                 // SKU编码
  name: string                 // 产品名称
  specification?: string       // 规格
  unit: string                 // 单位
  base_price: number           // 基础价
  cost_price?: number          // 成本价
  min_price: number            // 最低保护价
  tier_pricing_enabled: boolean // 是否启用阶梯价
  status: 'active' | 'inactive'
  created_at: string
  updated_at: string
}
```

### ProductPriceTier (阶梯价)
```typescript
interface ProductPriceTier {
  id: string
  product_id: string           // 关联SKU
  qty_from: number             // 数量起始（含）
  qty_to: number | null        // 数量结束（不含），null表示无限
  unit_price: number           // 该档单价
  sort_order: number           // 排序
  created_at: string
  updated_at: string
}
```

---

## API 端点

### GET /api/products
获取SKU列表（支持组织隔离）

**Query Parameters:**
- `org_id` (required): 组织ID
- `status`: 筛选状态 active|inactive
- `search`: 名称/编码搜索

**Response:**
```json
{
  "data": Product[],
  "pagination": { "page": 1, "pageSize": 20, "total": 100 }
}
```

### POST /api/products
创建SKU

**Body:**
```json
{
  "code": "SKU001",
  "name": "产品A",
  "unit": "件",
  "base_price": 1000,
  "min_price": 800,
  "tier_pricing_enabled": true
}
```

### GET /api/product-price-tiers?product_id={id}
获取某SKU的阶梯价列表

**Response:**
```json
{
  "data": ProductPriceTier[],
  "migrationRequired": false
}
```

### POST /api/product-price-tiers
创建/更新阶梯价

**Body:**
```json
{
  "product_id": "uuid",
  "qty_from": 1,
  "qty_to": 100,
  "unit_price": 950,
  "sort_order": 0
}
```

### POST /api/product-price-tiers/bulk
批量更新阶梯价（替换整个阶梯）

**Body:**
```json
{
  "product_id": "uuid",
  "tiers": [
    { "qty_from": 1, "qty_to": 100, "unit_price": 950 },
    { "qty_from": 101, "qty_to": null, "unit_price": 900 }
  ]
}
```

---

## 阶梯价命中算法

```typescript
function getTierPrice(product: Product, qty: number, tiers: ProductPriceTier[]): number {
  if (!product.tier_pricing_enabled || tiers.length === 0) {
    return product.base_price
  }
  
  // 按 qty_from 排序
  const sorted = tiers.sort((a, b) => a.qty_from - b.qty_from)
  
  // 找到命中的档位
  for (const tier of sorted) {
    if (qty >= tier.qty_from && (tier.qty_to === null || qty < tier.qty_to)) {
      return tier.unit_price
    }
  }
  
  // 未命中任何档位，返回基础价
  return product.base_price
}
```

---

## 边界约束

1. **组织隔离**: 所有查询必须带 `org_id` 过滤
2. **阶梯连续性**: 不允许断档（如 1-100, 200-300 缺少 101-199）
3. **价格下限**: 单价不得低于 `min_price`
4. **报价快照**: 报价创建时必须固化命中价格，不能保存实时引用

---

## 错误码

| Code | Status | 描述 |
|------|--------|------|
| MIGRATION_REQUIRED | 409 | 数据库未升级阶梯价结构 |
| INVALID_TIER_RANGE | 400 | 阶梯范围不连续或重叠 |
| PRICE_BELOW_MIN | 400 | 单价低于最低保护价 |
| ORG_ACCESS_DENIED | 403 | 无权访问该组织价盘 |
