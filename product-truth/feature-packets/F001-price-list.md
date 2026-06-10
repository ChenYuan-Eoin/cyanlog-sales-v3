# Feature Packet: F001-价盘与阶梯价

**Created**: 2026-06-01  
**REQ ID**: F001  
**Status**: in_progress  
**Parent**: 配置中心  
**Depends On**: `F000-config-center-architecture`

---

## 1. 单元定义

**目标**：在配置中心建立组织级价盘控制面，统一维护 SKU、基础价、保护价和阶梯价，作为报价中心自动算价的唯一价格来源。

**这包拥有的内容**：
- SKU 主数据
- 基础价 / 成本价 / 最低保护价
- 阶梯价区间
- 在售状态
- 组织级隔离

**这包不拥有的内容**：
- 报价单里的临时改价
- 折扣矩阵与审批流
- 供应商采购价体系

临时报价动作属于 `F002`，折扣与审批配置属于 `F010`。

---

## 2. 三层落位

| 层级 | 本功能对应物 |
|------|--------------|
| 第一层：能力域 | 价盘与阶梯价 |
| 第二层：具体配置 | SKU、基础价、阶梯价、状态、生效版本 |
| 第三层：消费页面 | 报价创建页、报价详情页、导出页 |

**硬边界**：
- 配置中心维护价盘
- 报价中心只读取已发布价格并写入报价快照

---

## 3. 配置对象

### 3.1 SKU 主数据
- `code`
- `name`
- `specification`
- `unit`
- `status`

### 3.2 价格对象
- `base_price`
- `cost_price`
- `min_price`
- `tier_pricing_enabled`

### 3.3 阶梯价对象
- `qty_from`
- `qty_to`
- `unit_price`
- `sort_order`

---

## 4. 数据建模原则

价盘不应塞进泛型 `configs` 表，优先保持强类型结构。

MVP 可接受的最小入侵方案：
- 保留 `products` 表并升级其 SKU 语义
- 增加 `tier_pricing_enabled`
- 新增 `product_price_tiers`

```sql
CREATE TABLE product_price_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    qty_from INT NOT NULL,
    qty_to INT NULL,
    unit_price DECIMAL(15, 2) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (product_id, qty_from),
    CHECK (qty_from >= 1 AND (qty_to IS NULL OR qty_to > qty_from))
);
```

报价侧不能保存“指向实时价盘的引用”，而要保存当时命中的价格快照。

---

## 5. 消费映射

| 消费方 | 读取什么 | 写入什么 |
|--------|----------|----------|
| `F002` 报价创建 | SKU、阶梯价、最小保护价 | 报价明细快照 |
| 报价详情页 | 历史单价快照 | 无 |
| 报价导出 | 报价行金额 | 导出文件 |

**规则**：报价创建时命中哪一档价格，必须固化到报价明细里；之后即使价盘变化，历史报价也不能被重算污染。

---

## 6. 客户端能力要求

配置中心前端至少应支持：
- SKU 列表
- 阶梯价摘要
- 编辑 SKU
- 编辑阶梯价
- 停售 / 启售

报价前端至少应支持：
- 选 SKU
- 输入数量
- 自动展示命中的单价档位
- 明确标出价格来源为“价盘配置”

---

## 7. 当前实现判断

当前方向基本正确，但之前的 packet 仍过于“Tab + Card 页面说明”，没有把“配置拥有权”和“消费快照”讲透。

本次回写后，F001 的正确定位是：
- 配置中心生产面
- 报价中心只读消费
- 强类型价格域，不进入泛型配置表

---

## 8. 涉及文件

- `product-truth/product-code/app/configs/page.tsx`
- `product-truth/product-code/app/api/products/route.ts`
- `product-truth/product-code/app/api/product-price-tiers/route.ts`
- `product-truth/product-code/app/quotes/new/page.tsx`
- `product-truth/product-code/supabase/migrations/20260608000001_org_pricing_and_quote_items.sql`

---

## 9. 验收标准

- [ ] 配置中心可维护 SKU 和阶梯价
- [ ] 组织间价盘隔离
- [ ] 报价创建可按数量命中对应阶梯价
- [ ] 报价明细固化价格快照
