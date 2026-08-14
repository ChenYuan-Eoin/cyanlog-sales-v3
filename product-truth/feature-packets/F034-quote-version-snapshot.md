# Feature Packet: F034-报价版本化与中间快照

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F034 |
| **Name** | 报价版本化与中间快照 |
| **Module** | 报价中心 |
| **Branch** | `feature/F034-quote-version-snapshot` |
| **Owner** | TBD（待指派） |
| **Created** | 2026-08-14 |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述

为报价引入「结构化版本 + 中间快照」双产物机制：

- **结构化报价版本 = 合同源数据**：报价批准/冻结时生成 V1/V2…，同一 quote 可多版本；版本是完整结构化 header + items 副本（价格/数量/版本/部署/授权/期限/折扣/税/赠送/维保等字段），可查询、可对比、可被下游推导消费（未来合同条款的源数据）。
- **不可变**：已发布版本禁止 UPDATE/DELETE，由 `BEFORE UPDATE` 触发器保证。
- **中间快照（阶段 1 交付物）**：`quote_snapshots(id, quote_id, version_no, snapshot jsonb, checksum, created_by, created_at)`，生成时与所选版本**逐位校验一致**；用途=导出渲染锁定、历史核对、防伪；**不是终点**——报价结构化版本仍是下游（合同）的真相与源数据。
- 验收硬门：历史版本不随配置漂移、快照与版本逐位一致、同报价多版本可对比、导出件防伪、报价字段仍可结构化读取。

来源：主设计 §二「报价版本 + 中间快照」、SC7；V3 现状审计（`quotes` 无 `version_no`、`quote_snapshots` 不存在、批准后仅 API 禁改、明细创建后不可改、CONFIRMED 合同承接断链后置）。

### 2.2 待确认问题

- [ ] 版本载体：主设计写 `quotes.version_no`，但「同一 quote 可多版本」无法只靠单行 quotes 承载。建议 `quotes.version_no` 作为当前版本指针 + `quote_versions/quote_version_items` 结构化副本表——确认此结构，还是用版本列 + 分区/历史表方案？
- [ ] 冻结时点：审批通过（APPROVED）自动生成，还是提供手动「冻结」动作？SC7 写「批准/冻结时」，两者是否都要？
- [ ] 版本号语义：草稿期 `version_no` 取 0/NULL；V1 冻结后继续修改，是生成 V2（新版本）还是禁止修改？主设计「同一 quote 可多版本」倾向允许 V2，需确认修改范围（整单可改 vs 仅明细）。
- [ ] `quote_snapshots` 保留策略/清理（多版本 × 多快照的存储膨胀）。
- [ ] checksum 序列化规范：decimal 精度、JSON key 排序、时间戳时区——需定唯一 canonical 序列化（否则「逐位一致」无法稳定断言）。
- [ ] 导出/打印是否强制走快照渲染锁定（阶段 1 建议强制，需确认回退路径）。
- [ ] 与相邻包依赖：版本复制依赖 F033（审批通过触发）、F027/F028（版本/部署/授权/期限字段）、F035（币种/税/赠送/维保字段）——版本机制是否在相关结构化字段落库前先冻结字段子集？

### 2.3 本轮边界

- **做**：
  - `quotes.version_no` 指针 + `quote_versions` / `quote_version_items` 结构化版本表。
  - `quote_snapshots` 中间快照表 + checksum 逐位一致校验。
  - `BEFORE UPDATE/DELETE` 触发器（已发布版本与快照不可变）。
  - `app/api/quotes/[id]/versions` 列表/详情/对比；导出渲染锁定走快照。
- **不做**：
  - 合同条款生成（F037 后置；本包只保证报价版本=结构化源数据就绪）。
  - 修复合同 CONFIRMED 断链（后置，与报价版本化一起重设计）。
  - 草稿期明细可编辑（前置修复 2，属报价编制链，另行确认）。
  - 快照作为下游推导终点的任何设计（快照非终点）。

---

## 3. 技术方案

> 依据：主设计 §二（quotes/quote_items ★ 字段、版本与快照关系）；SC7（文件清单与验收）；V3 现状 `001_initial_schema.sql`（quotes/quote_items）、`20260608000001_org_pricing_and_quote_items.sql`（org/快照字段）、`app/api/quotes/[id]/route.ts`（状态机无版本号）。

### 3.1 接口设计

| 接口 | 方法 | 说明 |
|---|---|---|
| `POST /api/quotes/[id]/versions` | POST | 冻结/生成新版本（内部由 F033 审批通过回调调用，或手动冻结）：事务内取号 → 复制结构化 header+items → 生成快照 → 返回 `{ version_no, checksum }`；成功后 `quotes.version_no` 指向新版本 |
| `GET /api/quotes/[id]/versions` | GET | 版本列表（version_no、frozen_at、frozen_by、checksum、状态） |
| `GET /api/quotes/[id]/versions/[versionNo]` | GET | 结构化版本详情（header + items，字段完整可查询） |
| `GET /api/quotes/[id]/versions/[versionNo]/diff?target=<v>` | GET | 同报价两版本逐字段对比（行级增删改 + 字段级差异） |
| `GET /api/quotes/[id]/versions/[versionNo]/verify` | GET | 快照与版本逐位一致校验：重算 canonical checksum，返回 `{ consistent: boolean }` |
| `GET /api/quotes/[id]/export` | GET | 导出/打印：锁定该版本快照渲染（快照缺失/不一致时 409 拒绝，防止读活表漂移） |

**内部 RPC**：`create_quote_version(quote_id, reason)` —— 单事务完成版本取号（`(quote_id, version_no)` 唯一约束防并发）、结构化复制、快照生成与 checksum 写入；任一步失败整体回滚，不产生半版本。

**错误码约定**：404 版本不存在；409 重复冻结/快照不一致/已发布版本被修改；422 结构化字段不完整（依赖字段缺失时拒绝冻结）。

### 3.2 数据模型

```sql
-- 报价头：当前版本指针（主设计 ★ version_no）
ALTER TABLE quotes ADD COLUMN version_no INT; -- DRAFT=0/NULL，冻结后为当前 V1/V2…

-- 结构化版本（合同源数据：完整 header 副本，列式可查询）
quote_versions (
  id UUID PK,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  quote_no TEXT, customer_name TEXT, customer_contact TEXT, notes TEXT, valid_until DATE,
  status TEXT, org_id UUID,
  currency VARCHAR(3) DEFAULT 'CNY', exchange_rate DECIMAL(18,6),
  fx_source TEXT, fx_date DATE, tax_inclusive BOOLEAN, amount_in_words TEXT, tax_summary JSONB,
  subtotal DECIMAL(15,2), discount_rate DECIMAL(5,2), discount_amount DECIMAL(15,2),
  tax_amount DECIMAL(15,2), total_amount DECIMAL(15,2),
  frozen_by UUID, frozen_at TIMESTAMPTZ,
  checksum TEXT,                              -- SHA-256(canonical(header+items))
  UNIQUE (quote_id, version_no)
)

-- 结构化版本明细
quote_version_items (
  id UUID PK,
  quote_version_id UUID NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  product_id UUID, product_code TEXT, name TEXT, specification TEXT, unit TEXT,
  version_code TEXT, deployment TEXT, auth_mode TEXT, term_months INT,
  quantity INT, unit_price DECIMAL(15,2), list_price DECIMAL(15,2),
  discount DECIMAL(15,2), line_total DECIMAL(15,2),
  tax_rate DECIMAL(6,4), tax_amount DECIMAL(15,2),
  is_gift BOOLEAN, gift_original_amount DECIMAL(15,2),
  maintenance_months INT, version_from TEXT, version_to TEXT,
  pricing_source TEXT, tier_range TEXT, sort_order INT
)

-- 中间快照（阶段 1 交付物：导出渲染锁定/历史核对/防伪，非终点）
quote_snapshots (
  id UUID PK,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  snapshot JSONB NOT NULL,       -- canonical 序列化的 header+items
  checksum TEXT NOT NULL,        -- 必须与 quote_versions.checksum 逐位一致
  created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

-- 不可变：已发布版本与快照禁止 UPDATE/DELETE（BEFORE 触发器，主设计要求）
-- 触发器作用于 quote_versions / quote_version_items / quote_snapshots：
--   BEFORE UPDATE OR DELETE → RAISE EXCEPTION 'frozen version/snapshot is immutable'
-- （工作副本仍在 quotes/quote_items 上编辑，不触发）

-- 索引
CREATE INDEX idx_quote_versions_quote ON quote_versions(quote_id, version_no DESC);
CREATE INDEX idx_quote_snapshots_quote ON quote_snapshots(quote_id, version_no DESC);
```

**逐位一致约定**：`checksum = SHA-256(canonical(header + items))`；canonical 规范待确认（JSON key 字典序、decimal 保留两位/六位、时间戳 UTC ISO8601），版本表与快照由同一 RPC 内同一序列化函数生成，杜绝两处各自组装。

### 3.3 状态机

```
报价工作副本：DRAFT ──审批通过(F033)──▶ APPROVED ──▶ 冻结生成 V1（version_no=1 + 快照）
             V1 后继续修改：APPROVED ──编辑──▶ DRAFT(V2 工作副本) ──审批通过──▶ APPROVED ──▶ 冻结 V2

版本对象：V1 frozen（只读）→ V2 frozen（只读）→ …  同一 quote 多版本并存、可对比
快照：随版本生成，immutable；verify 失败即视为防伪告警
```

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 触发器误伤草稿编辑 | 触发器只挂版本/快照表，工作副本 `quotes/quote_items` 不受影响 |
| checksum 序列化不稳定导致「逐位一致」断言漂移 | 单一 canonical 序列化函数 + 单元测试锁定（decimal 精度/key 排序/时区） |
| 配置变更（价盘/税率/审批规则）影响历史版本 | 版本=全量结构化字段副本，不存配置 ID 的现值引用；断言「历史版本不随配置漂移」 |
| 并发冻结取号冲突 | `UNIQUE(quote_id, version_no)` + RPC 单事务取号；冲突重试一次 |
| 版本/快照存储膨胀 | 2.2 确认保留策略；快照可按策略归档，版本表为最小保留真相 |
| 导出读活表而非快照导致漂移 | 导出强制 `quote_snapshots` 渲染锁定；缺快照/checksum 不一致返回 409 |
| 结构化字段依赖未落库（F027/F028/F035） | 冻结前字段完整性校验；依赖包未到位时先冻结现有字段子集并标记 pending 字段（待确认） |

---

## 4. 视觉锚点

### 4.1 参考页面
- 主设计 §二（quotes/quote_items 结构化字段表 + 版本/快照关系）
- SC7（版本/快照双产物、文件清单）
- 现状 `app/quotes/[id]/page.tsx`（报价详情，作为版本列表/对比的宿主）

### 4.2 组件
- 版本列表/时间线：V1/V2… 冻结时间、checksum、状态徽标
- 版本对比视图：header 字段级 diff + items 行级 diff（增删改高亮）
- 快照状态徽标：逐位一致 ✓ / 不一致 ✗（verify 入口）
- 导出按钮：显式声明「按 V{n} 快照渲染」

### 4.3 禁止偏离
- 禁止用不透明 JSON blob 替代结构化版本（版本必须可查询、可对比、可推导）
- 禁止对已发布版本/快照执行 UPDATE/DELETE（触发器兜底）
- 禁止导出读活表（quotes/quote_items）代替快照渲染锁定
- 禁止把快照当作下游推导终点（合同承接后置 F037，读取报价版本结构化字段）
- 禁止版本号重复/跳号写入（唯一约束 + 事务取号）

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | canonical 序列化、checksum 计算、版本创建事务、触发器拒绝、diff 算法 | 同输入序列化稳定（decimal/时间/JSON key 顺序）；checksum 变更即不一致；对已冻结版本 UPDATE/DELETE 抛异常；并发创建两版本不重复（唯一约束） |
| 接口测试 | `/versions` 列表/详情/diff/verify、`/export`、RPC `create_quote_version` | 修改配置（价盘单价/税率/审批规则）后旧版本字段与 checksum 完全不变（**历史版本不随配置漂移**）；`verify` 对合法快照返回一致、对篡改快照返回不一致；导出在快照缺失/不一致时 409 |
| E2E | 同报价 V1→修改→V2→对比→导出 | 同一 quote 生成 V1/V2 且版本号递增；版本对比展示字段与行级差异；导出件渲染内容与所选版本**逐位一致**；篡改快照后导出防伪告警 |
| 人工验收 | 历史真实单回归 | 历史真实单按版本回放，金额/明细/税/大写与历史单逐位一致；报价版本字段结构化可读（**合同源数据就绪**）；CONFIRMED 断链（合同后置）不阻塞本包验收 |

---

## 6. 实现记录

### 6.1 涉及文件
```
(开发后回填，每行加 REQ:F034 标记)
```

### 6.2 关键决策
- **决策**: (...)
- **理由**: (...)

### 6.3 非目标
- (...)

---

## 7. 评审记录

| 评审类型 | 评审人 | 状态 | 日期 | 备注 |
|---------|--------|------|------|------|
| PM 需求评审 | | | | |
| Dev 技术评审 | | | | |
| QA 测试评审 | | | | |

---

## 8. 发布记录

| 字段 | 值 |
|------|-----|
| **环境** | |
| **发布时间** | |
| **发布结果** | |
| **回滚点** | |

---

## 9. 回写记录

| 目标 | 状态 | 更新点 |
|------|------|--------|
| `REQ_REGISTRY.yml` F034 | 待更新 | |
| `03-design-truth/` | 待更新 | |
| `04-implementation-truth/` | 待创建 | |

---

## 附录：状态机

```
drafting → pm_review → tech_review → test_review → coding → code_review → qa_acceptance → ready_to_release → released
                                                                                          ↓
                                                                                        rejected
```

| 状态 | 含义 | 谁推进 |
|------|------|--------|
| `drafting` | AI 需求反讲中 | AI |
| `pm_review` | 等产品确认 | PM |
| `tech_review` | 等研发评审 | Dev |
| `test_review` | 等测试方案评审 | QA |
| `coding` | AI 编码中 | AI |
| `code_review` | 代码审查中 | Dev |
| `qa_acceptance` | 测试/产品验收中 | QA/PM |
| `ready_to_release` | 可发布 | DevOps |
| `released` | 已上线 | - |
| `rejected` | 被打回 | 任意 |
