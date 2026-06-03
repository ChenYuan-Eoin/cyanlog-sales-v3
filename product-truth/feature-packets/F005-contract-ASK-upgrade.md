# Feature Packet: F005-合同审核-两段式 ASK 升级 v2

**Created**: 2026-06-03
**Updated**: 2026-06-03 (v2 - 5 项设计决策落地)
**REQ ID**: F005 (upgrade)
**Status**: upgrade_pending
**Upstream**: F005 (合同审核) + F006 (红绿灯规则) + F008 (OCR)
**Downstream**: F007 (Word 批注生成) + 新增 report_versions

---

## 0. v2 变更摘要(2026-06-03)

基于 5 项设计决策,本版相对 v1 的关键变化:

| 决策 | v1 | v2 |
|------|----|----|
| 1. 一次回答 | 状态机: pending→partial→responded→verified→consumed(4 状态) | pending→responded→closed(3 状态) |
| 2. 必填 | 软提醒,可生成 | **硬关单**,无 pending 才能生成 |
| 3. 上传人触发+澄清人入报 | 报告引用 ASK | ASK 列表**显式入报**+澄清人姓名+角色+时间 |
| 4. 0 风险说明 | 静默跳过 | 显式说明"未触发原因" |
| 5. 版本管理 | 单次报告 | **rolling report**,响应即升版 |

**移除**:
- AI 二次判断(verdict) → 不再需要
- 部分回应(partial)状态 → 一次回答
- 验证(verified)状态 → 直接 consumed via report

**新增**:
- `report_versions` 表(报告版本管理)
- `no_ask_reason` 字段(0 风险时记录原因)
- `responder_name` 在报告中显式输出

---

## 1. 单元定义

### 1.1 一句话目标

把合同审核从"上传 → AI 出报告"升级为"上传 → AI 出 **ASK 清单** → 业务回应(必填) → 含 ASK 列表+澄清人姓名的批注报告"。

### 1.2 改造前后对比

| 阶段 | 改造前 | 改造后 |
|------|--------|--------|
| 输入 | 合同文件 | 合同文件 |
| 处理 | OCR → 规则 → AI → 报告 | OCR → 规则 → AI → **ASK 清单** → 业务回应(必填) → 报告 |
| 输出 | 纯 AI 推断报告 | **含 ASK 列表 + 澄清人姓名 + 业务事实**的批注 |
| 含金量 | 70% AI 推断 | 70% AI + 30% 业务事实 + 100% 责任留痕 |
| 报告形态 | 单次 | **rolling**(响应即升版) |

### 1.3 本轮做/不做

**做**:
- ASK 实体数据模型(3 状态: pending/responded/closed)
- AI 自动生成 ASK 清单(基于 OCR + 规则输出)
- 业务回应录入界面 + 角色分发
- **硬关单**: 有 pending 不让出报告
- **0 风险说明**: 未触发时显式说明原因
- 报告版本管理(响应即升版)
- 报告中**显式**输出 ASK 列表 + 澄清人姓名+角色+时间
- 文档更新(合同审核.md / PROJECT-主文档.md / REQ_REGISTRY.yml)

**不做**:
- AI 二次判断 / 反复追问
- 软提醒(留作 P1 配置项)
- 不改 OCR / 规则引擎的内部实现
- 不动 F007 批注生成器(消费侧适配即可)

---

## 2. 业务锚点

### 2.1 流程图

```
[销售/法务] 上传合同 (F005 POST /api/contracts)
   ↓ 谁上传 → 谁是 ASK 触发人
[系统] OCR 解析 (F008)
   ↓
[系统] 规则引擎扫描 (F006) → 结构化风险 (red/yellow/green)
   ↓
[系统] AI 语义分析 → 语义风险 (red/yellow/green)
   ↓
[系统] 生成 ASK 清单 (N 项) → 入库 ask_items
   ↓
   ┌─ N=0(无问题) ──→ 记录 no_ask_reason → 跳到报告生成
   │                   (报告抬头标注"未触发 ASK,原因:...")
   │
   └─ N>0 ──→ 进入回应阶段
              ↓
[销售/财务/法务] 录入业务回应(必填,一次回答)
              ↓
[系统] 响应入库 + 状态转 responded + 触发报告 v2 生成
              ↓
[任何人] 看到最新报告 v_n
   ↓
[法务] 可关闭单条 ASK(法务判定不需要, 不进报告)
[法务] 可标记"标准合同"(生成 v_n+1, 含标准说明)
   ↓
[系统] 报告归档(版本链 v1→v2→...→vn, 留痕)
```

### 2.2 状态机(ASK 单条, 3 状态)

```
PENDING (待回应,必填)
   ├─ 录入回应 → RESPONDED (触发报告升版)
   └─ 法务关闭 → CLOSED (不进报告,留痕)

RESPONDED → 不可再编辑(留痕)
   ├─ 法务重开 → PENDING(允许重新回应)
   └─ 触发新版本报告生成
```

**关键约束**:
- **一次回答**: 没有 partial / verified / insufficient 状态
- **RESPONDED 不可改**: 想改就 reopen(法务权限)
- **CLOSED 不进报告**: 法务判定为"伪风险"
- **硬关单**: 有任何 PENDING → 报告生成 422 拒绝

### 2.3 角色与责任

| 角色 | 可操作 | 不可操作 |
|------|--------|----------|
| 上传人(销售/法务) | 触发 ASK 生成、录入回应、重开 | 关闭 ASK(法务专属) |
| 销售 | 录入业务回应 | 关闭 |
| 财务 | 录入"财务/商务"类回应 | 关闭 |
| 法务 | 编辑 ASK 内容、关闭、重开、标记标准合同 | 删除已 RESPONDED |
| AI | 自动生成、聚合、版本号管理 | 录入人工内容 |

### 2.4 关键业务规则(5 条硬约束)

1. **预审必填**: 生成报告前,所有 ASK 必须 RESPONDED 或 CLOSED,否则 422
2. **一次回答**: 没有"追问"机制,回应即定稿
3. **谁上传谁触发**: 触发人在 audit_log 留痕
4. **澄清人入报**: 报告中每条 ASK 显示"responder_name (role) @ timestamp"
5. **rolling 版本**: 任何 ASK 状态变化 → 报告升版

### 2.5 0 风险处理

当 AI 生成 0 项 ASK:
- 报告**仍生成**,但抬头标注 "本轮未识别需业务回应的风险项"
- 必填字段 `no_ask_reason`(由 AI 生成,可人工覆盖):
  - `standard_contract`: 命中标准合同模板
  - `low_complexity`: 复杂度低(<5 页 + 无敏感条款)
  - `no_trigger_conditions`: 所有规则未触发
  - `manual_override`: 法务手动标记

---

## 3. 数据模型

### 3.1 ER 概览

```
contracts (已有, F005)
  ├─< ask_items (新增, 3 状态: pending/responded/closed)
  │     ├─ ask_responses (新增, 1:1 一次回答)
  │     ├─ ask_audit_logs (新增, 1:N 审计)
  │     └─< ask_role_assignments (新增, 1:N 多角色)
  └─< report_versions (新增, 1:N 报告版本)
```

### 3.2 ask_items 表

```sql
CREATE TABLE ask_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  ask_code        TEXT NOT NULL,                -- ASK-001, ASK-002
  clause_ref      TEXT,                          -- "合同第 3 条"
  risk_name       TEXT NOT NULL,                 -- "付款节奏偏离"
  initial_level   TEXT NOT NULL CHECK (initial_level IN ('red','yellow','green')),
  question_type   TEXT NOT NULL,                 -- 'commercial' | 'financial' | 'legal' | 'technical' | 'compliance'
  required_roles  TEXT[] NOT NULL,               -- ['sales','finance']
  question_text   TEXT NOT NULL,
  qualified_std   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','responded','closed')),
  trigger_user_id UUID NOT NULL REFERENCES auth.users(id),  -- 谁上传谁触发
  response_id     UUID REFERENCES ask_responses(id),         -- 1:1 一次回答
  closed_by       UUID REFERENCES auth.users(id),
  closed_reason   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contract_id, ask_code)
);

CREATE INDEX idx_ask_items_contract ON ask_items(contract_id);
CREATE INDEX idx_ask_items_status ON ask_items(status);
CREATE INDEX idx_ask_items_trigger ON ask_items(trigger_user_id);
```

### 3.3 ask_responses 表(1:1 一次回答)

```sql
CREATE TABLE ask_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id          UUID NOT NULL UNIQUE REFERENCES ask_items(id) ON DELETE CASCADE,  -- 1:1
  responder_id    UUID NOT NULL REFERENCES auth.users(id),
  responder_role  TEXT NOT NULL,                 -- 冗余
  responder_name  TEXT NOT NULL,                 -- 冗余,入报显示
  response_text   TEXT NOT NULL,
  attachments     JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 3.4 ask_audit_logs 表(关键事件)

```sql
CREATE TABLE ask_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id          UUID REFERENCES ask_items(id) ON DELETE CASCADE,
  contract_id     UUID NOT NULL,                 -- 冗余
  actor_id        UUID NOT NULL REFERENCES auth.users(id),
  actor_role      TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  -- 'created' | 'responded' | 'closed' | 'reopened' | 'report_generated' | 'no_ask_marked'
  from_status     TEXT,
  to_status       TEXT,
  payload         JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_ask ON ask_audit_logs(ask_id);
CREATE INDEX idx_audit_contract ON ask_audit_logs(contract_id);
CREATE INDEX idx_audit_created ON ask_audit_logs(created_at DESC);
```

### 3.5 ask_role_assignments 表

```sql
CREATE TABLE ask_role_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id          UUID NOT NULL REFERENCES ask_items(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  assignee_id     UUID REFERENCES auth.users(id),
  UNIQUE(ask_id, role, assignee_id)
);
```

### 3.6 report_versions 表(新增, 报告版本管理)

```sql
CREATE TABLE report_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,              -- 1, 2, 3, ...
  trigger_event   TEXT NOT NULL,
  -- 'initial_generate' | 'ask_responded' | 'ask_reopened' | 'ask_closed' | 'standard_marked'
  trigger_ask_id  UUID REFERENCES ask_items(id),  -- 哪个 ASK 触发了这次升版
  trigger_user_id UUID REFERENCES auth.users(id),
  no_ask_reason   TEXT,                          -- 0 风险时填
  report_data     JSONB NOT NULL,                 -- 完整报告快照(含 ASK + 回应)
  report_file_url TEXT,                          -- Word 批注文件 URL
  is_current      BOOLEAN NOT NULL DEFAULT false,-- 是否最新版本
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contract_id, version)
);

CREATE INDEX idx_report_versions_contract ON report_versions(contract_id);
CREATE INDEX idx_report_versions_current ON report_versions(contract_id, is_current) WHERE is_current = true;
```

**rolling 机制**:
- 任何 ASK 状态变化 → 写入新 `report_versions` 行,version+1,is_current=true
- 旧版本 is_current=false(留作历史)
- 查询时永远返回 is_current=true 的最新版本

---

## 4. API 设计

### 4.1 总览(6 个新端点 + 1 升级)

| 方法 | 路径 | 描述 | 变化 |
|------|------|------|------|
| POST | /api/contracts/:id/asks/generate | AI 生成 ASK 清单 | v1 同 |
| GET | /api/contracts/:id/asks | 列出 ASK | v1 同 |
| GET | /api/asks/:id | ASK 详情(含回应) | v1 同 |
| **POST** | **/api/asks/:id/responses** | 录入回应(1:1 一次回答) | v1 同,语义改 |
| ~~POST~~ | ~~/api/asks/:id/ai-verdict~~ | ~~AI 二次判断~~ | **v2 移除** |
| POST | /api/asks/:id/transition | 状态流转(close/reopen) | v1 同 |
| **GET** | **/api/contracts/:id/reports/current** | 当前最新报告 | **v2 新增** |
| **GET** | **/api/contracts/:id/reports/versions** | 报告版本列表 | **v2 新增** |
| POST | /api/contracts/:id/export | 报告生成(硬关单) | **v2 升级** |

### 4.2 POST /api/contracts/:id/asks/generate(不变)

**请求**:
```typescript
{
  force_regenerate?: boolean
}
```

**响应 200**:
```typescript
{
  success: true,
  data: {
    contract_id: string,
    generated_count: number,    // 0 时进 0 风险分支
    no_ask_reason: string | null,  // 0 时填
    items: AskItem[]
  }
}
```

**响应 200 (0 风险)**:
```typescript
{
  success: true,
  data: {
    contract_id: string,
    generated_count: 0,
    no_ask_reason: "standard_contract",  // 'standard_contract' | 'low_complexity' | 'no_trigger_conditions' | 'manual_override'
    no_ask_explanation: "AI 识别本合同命中标准模板(参见 002_add_contracts.sql),所有规则未触发,默认无业务风险。",
    items: []
  }
}
```

### 4.3 POST /api/asks/:id/responses(语义改)

**核心变化**: 一次回答,触发报告升版

**请求**:
```typescript
{
  response_text: string,
  attachments?: Array<{name: string, url: string, type: string}>
}
```

**响应 201**:
```typescript
{
  success: true,
  data: {
    response: AskResponse,
    ask_status_after: 'responded',
    // 同步触发报告升版
    new_report_version: {
      version: number,         // 自动 +1
      trigger_event: 'ask_responded',
      report_file_url: string
    }
  }
}
```

### 4.4 POST /api/asks/:id/transition(简化)

**请求**:
```typescript
{
  action: 'close' | 'reopen',
  reason?: string  // close 时必填
}
```

**响应 200**:
```typescript
{
  success: true,
  data: {
    ask_id: string,
    new_status: 'closed' | 'pending',
    new_report_version?: {      // 触发升版时填
      version: number,
      trigger_event: 'ask_closed' | 'ask_reopened',
      report_file_url: string
    },
    audit_log_id: string
  }
}
```

### 4.5 GET /api/contracts/:id/reports/current(新增)

**响应 200**:
```typescript
{
  success: true,
  data: {
    contract_id: string,
    current_version: number,
    is_current: true,
    no_ask_reason: string | null,
    no_ask_explanation: string | null,
    report_data: {
      ask_items: AskItemWithResponse[],   // 已含回应+澄清人
      summary: {
        total: number,
        responded: number,
        pending: number,        // 必填关单:0 才允许
        closed: number
      }
    },
    report_file_url: string
  }
}
```

### 4.6 GET /api/contracts/:id/reports/versions(新增)

**响应 200**:
```typescript
{
  success: true,
  data: {
    versions: Array<{
      version: number,
      trigger_event: string,
      trigger_ask_code: string | null,   // 'ASK-001' / null
      trigger_user_name: string,
      no_ask_reason: string | null,
      created_at: string,
      is_current: boolean
    }>
  }
}
```

### 4.7 POST /api/contracts/:id/export(升级, 硬关单)

**变化**: 报告生成前**硬关单**所有 pending ASK

**请求**:
```typescript
{}  // 空体
```

**响应 200**:
```typescript
{
  success: true,
  data: {
    contract_id: string,
    new_version: number,        // 升版
    report_file_url: string,
    ask_summary: {
      total: number,
      responded: number,
      closed: number,
      pending: number           // 必为 0
    }
  }
}
```

**响应 422(硬关单触发)**:
```typescript
{
  success: false,
  error: 'PENDING_ASKS_BLOCK',
  message: '存在未回应的 ASK,无法生成报告',
  data: {
    pending_asks: [
      { ask_code: 'ASK-001', risk_name: '付款节奏偏离', clause_ref: '第 3 条' },
      { ask_code: 'ASK-003', risk_name: '违约金比例偏高', clause_ref: '第 7 条' }
    ],
    hint: '请先回应或由法务关闭全部 ASK'
  }
}
```

### 4.8 AskItem + Report Schema(共享)

```typescript
interface AskItem {
  id: string;
  contract_id: string;
  ask_code: string;
  clause_ref: string | null;
  risk_name: string;
  initial_level: 'red' | 'yellow' | 'green';
  question_type: 'commercial' | 'financial' | 'legal' | 'technical' | 'compliance';
  required_roles: string[];
  question_text: string;
  qualified_std: string;
  status: 'pending' | 'responded' | 'closed';
  trigger_user_id: string;     // 谁上传谁触发
  response_id: string | null;
  closed_by: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface AskItemWithResponse extends AskItem {
  response: AskResponse | null;
  response_count: 0 | 1;       // v2 强制 0 或 1
}

interface AskResponse {
  id: string;
  ask_id: string;
  responder_id: string;
  responder_role: string;
  responder_name: string;      // 冗余,入报显示
  response_text: string;
  attachments: Array<{name: string; url: string; type: string}>;
  created_at: string;
}
```

---

## 5. 报告内容(v2 升级)

### 5.1 报告抬头

```
Cyanlog 合同预审报告 v{n}                          生成时间: 2026-06-03
合同编号: CT-2026-001                              客户: XX 科技
触发人: 张三 (销售) @ 2026-06-03 14:30
本轮 ASK 状态: 全部 5 项已回应 / 0 项待回应 / 0 项关闭

# 0 风险报告时:
本轮未识别需业务回应的风险项
原因: standard_contract (命中标准合同模板 v2.1)
说明: 所有审核规则未触发,默认无业务风险。法务可在 /contracts/:id/mark-standard 标记。
```

### 5.2 报告正文(每条 ASK 一段)

```text
═══════════════════════════════════════════════════
ASK-001  付款节奏偏离                       🟡 黄线
═══════════════════════════════════════════════════
位置: 📍 合同第 3 条
风险: 付款节奏不同于 ONES 标准,影响回款确定性。

【必问问题】
1. 客户要求该付款节奏的原因是什么?
2. 是否已尝试恢复 ONES 标准付款节奏?
3. 若无法恢复,客户是否提供商业对价?
4. 财务是否接受该回款安排?

【澄清人回应】李四 (财务) @ 2026-06-03 15:12
客户因内部预算流程要求 30/60/10,销售已确认无恢复空间。
财务接受,但要求首付款不低于 30%,尾款不超过 10%。

【报告结论】可作为偏离项提交审批。

═══════════════════════════════════════════════════
ASK-002  违约金比例偏高                     🟡 黄线
═══════════════════════════════════════════════════
位置: 📍 合同第 7 条
风险: 违约金比例超过 5% 标准。

【必问问题】
...

【澄清人回应】王五 (法务) @ 2026-06-03 15:30
...

【报告结论】...
```

### 5.3 与 v1 报告的差异

| 段落 | v1 | v2 |
|------|----|----|
| 报告抬头 | 静态 | 含触发人 + ASK 状态汇总 + 0 风险说明 |
| 风险描述 | 1 行 | 1 段 |
| 必问问题 | (在 ASK 录入页有,不入报) | **入报** |
| 澄清人回应 | "业务回应"1 段 | **澄清人姓名+角色+时间** 1 段 |
| 报告结论 | 1 行 | 1 段 |
| 0 风险时 | 不生成 | 生成 + 显式说明 |

---

## 6. 涉及文件清单

### 6.1 新建(12)

```
supabase/migrations/20260603000003_add_ask_items.sql
supabase/migrations/20260603000004_add_ask_responses.sql
supabase/migrations/20260603000005_add_ask_audit_logs.sql
supabase/migrations/20260603000006_add_ask_role_assignments.sql
supabase/migrations/20260603000007_add_report_versions.sql
app/api/contracts/[id]/asks/generate/route.ts
app/api/contracts/[id]/asks/route.ts
app/api/asks/[id]/route.ts
app/api/asks/[id]/responses/route.ts
app/api/asks/[id]/transition/route.ts
app/api/contracts/[id]/reports/current/route.ts
app/api/contracts/[id]/reports/versions/route.ts
app/contracts/[id]/asks/page.tsx
app/contracts/[id]/asks/_components/
lib/ask/generator.ts
lib/ask/verdict.ts                    # v2: 仅生成,不做 AI 二次判断
lib/ask/types.ts
lib/ask/no-ask-detector.ts            # v2 新增: 0 风险原因推断
lib/ask/prompts/
  generate-ask-list.ts
lib/report/version-manager.ts          # v2 新增: rolling 报告
```

### 6.2 修改(5)

```
app/contracts/[id]/page.tsx           # 新增"ASK 清单"标签页 + 报告版本入口
app/api/contracts/[id]/analyze/route.ts # 审核完成后自动调 generate
app/api/contracts/[id]/export/route.ts  # 硬关单 + 升版
lib/export/word-generator.py          # v2 报告内容模板
lib/export/word-generator.ts          # v2 报告内容模板
```

### 6.3 文档更新(3)

```
product-truth/01-business-truth/合同审核.md          # 第 8 章同步
product-truth/00-master/PROJECT-主文档.md            # 5.7 同步
product-truth/REQ_REGISTRY.yml                        # F005 标注补 report_versions
```

---

## 7. 验收标准

### 7.1 功能验收(TC v2)

| TC | 场景 | 预期 |
|----|------|------|
| TC-B01 | 上传后 AI 生成 5 项 ASK | ask_items 5 条,状态 pending |
| TC-B02 | 销售录入 ASK-001 回应 | 状态转 responded,触发 v2 报告生成 |
| TC-B03 | 报告含 ASK-001 完整段 | 抬头有"5 项回应/0 待回应/0 关闭",ASK-001 段含澄清人姓名+角色+时间 |
| TC-B04 | 法务关闭 ASK-002 | 状态转 closed,触发 v3 报告,ASK-002 不在 v3 报告 |
| TC-B05 | 仍有 pending 时点"生成报告" | 422 PENDING_ASKS_BLOCK,返回所有 pending |
| TC-B06 | 0 风险合同生成 ASK | generated_count=0,no_ask_reason 填,报告抬头含"未识别需业务回应的风险项" |
| TC-B07 | 同一 ASK 录 2 次回应 | 第 2 次返回 409 RESPONSE_ALREADY_EXISTS |
| TC-B08 | 已 responded 想改 | 法务 reopen → pending → 可再录 |
| TC-B09 | 历史报告查询 | /reports/versions 返回 v1~vn,is_current 标最新 |
| TC-B10 | 财务/销售都能录回应 | 角色不卡,但角色记入 responder_role + 报告显式 |
| TC-B11 | 报告 v1→v2→v3 时间线 | audit_log 全留,版本链可追溯 |
| TC-B12 | 法务重开后,旧响应被覆盖? | 旧响应保留,新响应追加,新版本报告用最新 |

### 7.2 业务验收(给销售/法务看的报告)

**销售视角**(验收报告独立 doc:`product-truth/feature-packets/F005-ASK-验收报告.md`):
- 看到自己触发的 ASK 列表 + 必问问题模板
- 录入回应有字段说明(必填项 + 字数)
- 看到澄清人入报后的"含金量提升"
- 报告版本能看到每次回应带来的变化

**法务视角**:
- 看到所有待回应/已回应/已关闭
- 关闭 ASK 有 reason 必填
- 重开 ASK 有审计
- 报告版本可回溯

### 7.3 性能验收

- 单合同 ASK 生成 ≤ 30 秒
- 单条回应录入 + 报告升版 ≤ 15 秒
- 报告当前版查询 ≤ 200ms

### 7.4 必跑检查

- [ ] `pnpm tsc --noEmit` / `lint` / `test` / `build` 通过
- [ ] TC-B01~B12 全部通过
- [ ] 浏览器实跑:上传 → 审核 → 生成 ASK → 销售回应(触发 v2) → 法务关闭一条(触发 v3) → 生成报告(看版本链)
- [ ] 验收报告独立 doc 完成

---

## 8. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 | 回滚 |
|------|------|------|------|------|
| 硬关单导致销售卡住 | 高 | 高 | 0 风险合同跳过;法务可关闭 | 加配置项临时改软提醒 |
| rolling 报告膨胀 | 中 | 中 | 旧版本归档到冷存储 | 限制保留最近 N 版 |
| 0 风险误判 | 中 | 高 | 法务可手动 override + 标"非标准合同" | 重新生成 ASK |
| 响应 1:1 限制导致业务反复 | 中 | 中 | 法务 reopen 即可 | 不需改 |
| v2 表结构破坏 v1 数据 | 低 | 高 | 独立 migration,顺序执行 | DROP 新表 |

---

## 9. 任务拆解(2 周 Sprint)

```
W1 D1-2: migration 5 表 + types + API scaffold
W1 D3-4: 7 个端点(generate/get/responses/transition/reports)
W1 D5:   lib/ask/generator + no-ask-detector + LLM prompts
W2 D6:   lib/report/version-manager + F007 适配
W2 D7-8: UI(/asks 页面 + 报告版本展示)
W2 D9:   TC-B01~B12 + e2e
W2 D10:  验收报告独立 doc + 文档同步
```

**并行点**:
- 5 张 migration 与 F007 适配可并行
- API 端点 2 人并行(读 / 写 分离)
- LLM prompts 与 UI 可并行

---

## 10. 苏格拉底式终评触发

本 v2 packet 完成后,通过以下正则触发 skill-socrates:
- 文件名匹配 `F005-合同审核-两段式ASK升级`
- 状态 `upgrade_pending` → `confirmed`

预期追问方向:
- 业务闭环风险(销售故意不录回应,法务不接管)
- 数据一致性(rolling 报告与 ask_items 状态同步)
- 角色权限(销售冒充财务录回应)
- 性能成本(每条响应触发一次 LLM 升版)
- 0 风险误判(AI 漏识别,法务没发现)

---

## 11. 开放问题(留给评审)

1. rolling 报告保留多少版?(建议:最近 20 版,归档冷存储)
2. 财务/销售回应时,角色从 token 推还是表单选?(建议:token 推,前端只读)
3. 硬关单的"PENDING_ASKS_BLOCK"是否提供"我已知风险仍要生成"按钮?(建议:否,法务关闭才能绕过)
4. 0 风险合同的"未触发说明"是否每合同独有还是全局规则推断?(建议:每合同独有,法务可覆盖)
5. 法务重开时,旧响应是覆盖还是保留?(建议:保留,append-only,审计完整)
