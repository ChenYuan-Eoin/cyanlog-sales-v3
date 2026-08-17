# Feature Packet: F043-审批规则化

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F043 |
| **Name** | 审批规则化 |
| **Module** | 报价中心 / 配置中心（审批能力域） |
| **Branch** | `feature/F043-approval-configurable` |
| **Owner** | TBD（待指派） |
| **Created** | 2026-08-14 |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述

把 V3 当前硬编码、未接线的「三级审批」改造成**全配置化审批**：

- 触发与路由全部进配置中心：`approval_rules`（场景×条件→链）、`approval_chains`（串行/并行的执行模板）、`approval_chain_nodes`（节点=角色/组织/关系/指定人，**不引用人名**）、`roles`（角色→成员）。
- 报价提交 `DRAFT → PENDING_APPROVAL` 时按命中规则创建 `approvals` 执行记录（接线，替代当前「创建者自己改状态」的空壳）。
- 新增 `/api/approvals` 审批中心接口与页面；角色/组织/关系解析出实际待办人；驳回重提时跳过已通过节点；打印/导出对审批人、审批意见脱敏。
- `approvals` 表从执行记录升级为可追溯记录：补 `org_id`、`quote_id` 外键、`rule_snapshot jsonb`（命中的规则+链+节点快照，规则后续变更不污染历史）。

来源：主设计 O5 + SC5；V3 现状审计（`lib/approval/workflow.ts` 硬编码 5/10/100 且全仓库无调用、`approvals` 表无 API、报价状态由创建者自改）。

### 2.2 待确认问题

- [ ] G1：默认种子口径。主设计 O5 原型口径为「≥50% 区域负责人、<50% 特批、维保<10%、升级<15%」，与现有 F004/`workflow.ts` 的 5/10/100 冲突——以哪套为准（待业务定稿）？
- [ ] 折扣率口径：按 `discount_amount / subtotal` 还是 `(list_price - total) / list_price`？行级折扣与整单折扣如何合并计算触发？
- [ ] `mode=parallel / quorum` 首批是否启用？F004 明确本轮不做会签/并签，O5 又支持 parallel——确认本包只做 serial（parallel 仅建模不消费）还是全做。
- [ ] `assignee_type=relation`（如直属上级）的解析数据源：现有 `organizations / user_organizations / users` 是否足够，是否需要组织层级表？
- [ ] 重提跳过语义：驳回后重提是「跳过已通过节点直接到被驳回节点」还是「整链重跑」？
- [ ] 审批人展示策略：脱敏范围是仅打印/导出，还是审批中心页面也不显示人名（硬门要求「审批路由不出现人名」需明确边界）？
- [ ] `delegation_rules`（委托代理）本轮是否只建模、不消费？F004 原声明不做委托代理。
- [ ] 审批超时 `timeout_hours / escalation` 本轮是否只落字段不实现提醒（F019 另包）？

### 2.3 本轮边界

- **做**：
  - O5 四对象（rules/chains/nodes/roles）入配置中心五触点（`lib/configs/types.ts → validation.ts → runtime.ts → app/api/config-center/approval-* → app/configs`）。
  - 引擎接线：`lib/approval/workflow.ts` 去掉 `defaultConfigs`，提交时按配置创建 `approvals`。
  - `approvals` 表扩展：`org_id`、`FK quote_id`、`rule_snapshot jsonb`。
  - `/api/approvals` 列表/详情/审批动作接口 + 审批中心页面（`app/approvals`）。
  - 角色/组织解析、重提跳过、打印/导出脱敏。
- **不做**：
  - 审批超时提醒/升级执行（F019）。
  - 复杂会签/并签消费（若确认首批 serial）。
  - 委托代理消费（`delegation_rules` 是否建模待确认）。
  - 合同承接（CONFIRMED 后置，F037）。
  - 不在报价页/审批页暴露配置写入口（F000 强约束）。

---

## 3. 技术方案

> 依据：主设计 O5 / SC5 / 四、报价侧前置修复 1；F000 配置中心三层架构与消费边界；V3 现状 `lib/approval/workflow.ts`、`supabase/migrations/20260602000008_add_runtime_support_tables.sql`、`app/api/quotes/[id]/route.ts`。

### 3.1 接口设计

**配置面（配置中心五触点，`app/api/config-center/approval-*`）**

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/config-center/approval-rules` | GET/POST | 规则列表/新建（场景、条件、chain_id、priority、enabled） |
| `/api/config-center/approval-rules/[id]` | GET/PATCH/DELETE | 规则详情/编辑/停用 |
| `/api/config-center/approval-rules/[id]/versions` `.../publish` `.../rollback` | GET/POST | 版本化发布/回滚（统一五触点语义） |
| `/api/config-center/approval-chains` 及 `[id]` | GET/POST/PATCH | 链与节点（含节点顺序、assignee、skip_on_unchanged、timeout_hours、escalation） |
| `/api/config-center/approval-roles` 及 `[id]` | GET/POST/PATCH | 角色与成员维护 |
| `/api/config-center/approval-rules/[id]/dry-run` | POST | 发布前干跑：输入报价快照→返回命中的链与解析后的待办人集合（校验可解析、防无人审批） |

**执行面（报价/审批）**

| 接口 | 方法 | 说明 |
|---|---|---|
| `POST /api/quotes/[id]/submit` | POST | 从 DRAFT 校验后按规则创建 approvals，状态置 PENDING_APPROVAL；命中规则失败/无人可达时返回 422 并保持 DRAFT |
| `GET /api/approvals` | GET | 审批中心列表（org 隔离，支持 quote_id/status 过滤） |
| `GET /api/approvals/[id]` | GET | 审批详情（含 quote 摘要、规则快照、节点上下文） |
| `POST /api/approvals/[id]/approve` `.../reject` | POST | 审批动作；越权返回 403 并写审计留痕 |
| `POST /api/quotes/[id]/resubmit` | POST | 驳回后重提：按 skip_on_unchanged/重提语义跳过已通过节点 |

**错误码约定**：403 越权（非当前待办人/非本 org）；404 记录不存在；409 审批已处理/状态冲突；422 规则不可解析（无有效待办人）或提交校验失败。

### 3.2 数据模型

**配置对象（新表，均带 org_id + 版本化/发布语义，走 F000 强类型约束）**

```sql
-- 规则：场景×条件 → 链
approval_rules (
  id UUID PK, scene TEXT,           -- discount/special_approval/maintenance/upgrade
  condition JSONB,                  -- 阈值/比较器组合，如 {"field":"discount_rate","op":">=","value":0.5}
  chain_id UUID FK approval_chains(id),
  priority INT, enabled BOOLEAN, org_id UUID FK,
  created_by UUID, created_at, updated_at
  -- 多条命中取 priority 最严（数值最大或显式最严标记，待确认）
)

-- 链：执行模板
approval_chains (
  id UUID PK, name TEXT, mode TEXT CHECK (mode IN ('serial','parallel')),
  quorum TEXT CHECK (quorum IN ('all','any')), org_id UUID FK, ...
)

-- 节点：只引用角色/组织/关系，禁止人名
approval_chain_nodes (
  id UUID PK, chain_id UUID FK,
  ord INT,
  assignee_type TEXT CHECK (assignee_type IN ('role','org','user','relation')),
  assignee_value TEXT,              -- role_code / org_id / user_id / relation_code
  skip_on_unchanged BOOLEAN, timeout_hours INT, escalation JSONB,
  org_id UUID FK, ...
)

-- 角色
roles (
  id UUID PK, name TEXT, members JSONB,  -- members[] user_id（或 role_members 关联表，待确认）
  org_id UUID FK, ...
)
```

**执行记录（改造现有 `approvals`，依据 20260602000008）**

```sql
ALTER TABLE approvals
  ADD COLUMN org_id UUID REFERENCES organizations(id),           -- 主设计 O5 落点
  ADD COLUMN rule_snapshot JSONB,                                -- 命中 rule+chain+node 序列快照，不可变
  ADD COLUMN chain_node_id UUID,                                 -- 当前节点（追溯用）
  ADD CONSTRAINT approvals_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id); -- 现状为无 FK 的 NOT NULL

-- 保留字段：level（节点序号兼容）、approver_id、approver_role、status、comment、completed_at、created_at
-- status 语义扩展：pending / waiting / approved / rejected（驳回仅当前节点；整单状态由 quotes 状态机表达）
-- RLS：按 org_id 隔离 + 待办人/发起人可见；写操作仅服务端 supabaseAdmin 与持有待办权限的用户
```

**追溯与脱敏**：`rule_snapshot` 在创建 approvals 时固化；审批中心列表/详情与打印/导出只输出角色名、组织名、关系名与动作结果，不输出 `approver_id` 对应的人名/`display_name`。

### 3.3 状态机

```
quotes: DRAFT ──submit(命中规则)──▶ PENDING_APPROVAL ──全部通过──▶ APPROVED（触发 F044 冻结/版本生成）
              ▲                          │
              │ reject(驳回)             │ approve(还有下一节点)
              └──────── REJECTED ◀───────┘
  重提：REJECTED ──resubmit──▶ PENDING_APPROVAL（跳过已通过节点，从被驳回节点继续）

approvals 记录：pending → approved / rejected（单节点终态；waiting 为未激活节点）
```

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 规则误配导致无人可达（配置后所有报价卡在 PENDING_APPROVAL） | 发布前强制 dry-run 校验：命中链的每个节点至少可解析出 ≥1 名成员；失败拒绝发布；运行时 422 保持 DRAFT 并提示 |
| 规则变更影响在途审批 | `rule_snapshot` 固化命中时的规则/链/节点；在途审批不受新配置影响（历史版本不随配置漂移） |
| 角色/组织解析数据缺失（关系无数据源） | 2.2 确认关系解析范围；缺数据时降级为 org 负责人或显式人工指派，发布校验拦截「不可解析」 |
| 越权审批 | 每次动作校验待办人=当前节点解析结果且同 org；越权 403 并写审计留痕 |
| 脱敏遗漏（人名出现在打印/导出） | 输出流统一走白名单字段（O6 派生）；E2E 断言审批响应与导出件不含 display_name |
| 与现有自我审批路径并存 | 删除/禁用 quotes/[id]/route.ts 中直接改状态逻辑，全部走 submit/approve/reject 接口 |

---

## 4. 视觉锚点

### 4.1 参考页面
- 主设计 O5（审批规则/链/节点/角色字段与默认种子）
- `product-truth/feature-packets/F004-approval-workflow.md`（现有三级审批状态机与页面意图）
- `product-truth/feature-packets/F000-config-center-architecture.md`（配置中心三层架构、「组织与权限是独立控制面」）

### 4.2 组件
- 配置中心「审批」能力域 Tab：规则列表、链设计器（节点拖拽排序、assignee 选择器）、角色成员管理、发布/回滚、dry-run 预览
- 审批中心页（`app/approvals`）：待办列表、详情、通过/驳回、脱敏展示
- 报价单详情页：审批状态条（只读消费配置结果，无写入口）

### 4.3 禁止偏离
- 禁止在报价页/审批页直接写审批配置（F000：业务页面只能消费配置）
- 禁止把审批对象压进泛型 `configs` 表（F000 5.2 强类型表优先）
- 禁止节点引用人名（硬门：审批路由不出现人名）
- 禁止保留 `defaultConfigs` 硬编码（5/10/100 + 角色名）
- 禁止把「规则配置」与「规则执行」写进同一个 F 包同一层（F000 反模式清单）

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | 规则命中（阈值/比较器组合、priority 最严）、链/节点展开、角色/组织/关系解析、重提跳过、rule_snapshot 固化 | 配置 5/10/100 与 50/特批 两套种子分别验证边界（5、5.01、10、10.01、50）；命中规则变更后历史 approvals 的 rule_snapshot 不变；`workflow.ts` 不再包含 `defaultConfigs` |
| 接口测试 | `/api/quotes/[id]/submit`、`/api/approvals` 列表/详情/approve/reject、resubmit、dry-run | submit 后 approvals 按命中链创建且状态正确；非待办人/跨 org 动作返回 403 且审计留痕；无人可达规则 dry-run 拒绝发布、submit 返回 422 保持 DRAFT；审批路由响应体不含任何 display_name/人名 |
| E2E | 报价提交→多级审批→通过/驳回→重提→通过；审批中心列表 | 全流程在配置驱动下完成；重提从被驳回节点继续（已通过节点保持 approved）；审批中心按 org 隔离；打印/导出件零泄漏（无审批人、审批意见、成本/底价/毛利） |
| 人工验收 | 真实单回归 + 业务口径确认 | 历史真实单按新规则路由通过且路径与业务预期一致；G1 种子经业务确认；硬门「审批路由不出现人名」由接口断言 + 人工抽查导出件双重确认 |

---

## 6. 实现记录

### 6.1 涉及文件
```
(开发后回填，每行加 REQ:F043 标记)
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
| `REQ_REGISTRY.yml` F043 | 待更新 | |
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
