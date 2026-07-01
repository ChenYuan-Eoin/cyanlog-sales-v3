# Feature Packet: F006-合同审核 Skill 运行时

**REQ ID**: F006
**Status**: confirmed
**Parent**: 合同审核 / 配置中心消费侧
**Depends On**: `F005v2-contract-center`, `F009-contract-rule-config`, `F012-ai-runtime-config`
**Consumed By**: `F005` 合同中心, `F007` Word 批注导出

---

## 1. 单元定义

**目标**：把配置中心发布的规则、知识库模板、条款库、输出 schema 和模型策略编译成可运行、可追溯、可回放的 `SkillBundle`，供合同审核运行消费。

F006 不是“代码里写一段合同审核 prompt”，也不是“规则引擎 if/else 集合”。F006 是审核执行内核，负责把控制面事实转成审核运行事实。

**这包拥有的内容**：
- `SkillBundle` 结构与生命周期
- 规则快照、模板快照、知识库引用的运行时装配
- 结构化规则、语义规则、模板对比的执行编排
- 模型调用输入约束、输出 schema、结果校验
- `RiskFinding` 与 `ReviewEvidence` 的生成
- 与 F007 的 `CommentPatch` 交接契约

**这包不拥有的内容**：
- 合同工作台 UI、风险分派、销售谈判（属于 `F005`）
- 规则配置编辑、发布、回滚（属于 `F009`）
- 模型 Provider、Key、路由策略配置（属于 `F012`）
- Word 原生批注文件生成（属于 `F007`）

---

## 2. SkillBundle 定义

`SkillBundle` 是一次可发布、可运行、可审计的审核技能包。

| 组成 | 来源 | 说明 |
|------|------|------|
| `rule_snapshot_ids` | F009 | 已发布规则快照，包含结构化/语义/混合规则 |
| `template_snapshot_ids` | 知识库/模板库 | 标准合同模板、条款模板、案例、话术 |
| `variant_dictionary_snapshot_id` | 知识库/词典 | 产品、部署、授权、法律、财务术语变体 |
| `output_schema` | F006 | 风险项、证据、批注意图、报告摘要的结构约束 |
| `model_policy_id` | F012 | 本地/云端/规则兜底路由策略 |
| `eval_case_ids` | F009/F006 | 发布前回归测试用例 |
| `release_meta` | F006 | 发布人、发布时间、适用范围、版本说明 |

### 2.1 生命周期

```
draft
  -> simulated
  -> published
  -> compiled
  -> regression_passed
  -> bound_to_review_run
  -> archived
```

约束：
- `draft` Skill 不能被合同审核消费。
- `published` 后必须生成不可变快照。
- `ReviewRun` 绑定 `SkillBundle` 后，后续规则或模型配置变化不能影响历史结果。
- `archived` 只影响新审核，不影响历史追溯。

---

## 3. 审核执行管线

```
ContractVersion
  -> 文本/结构归一化
  -> 合同类型与模板匹配
  -> 结构化规则执行
  -> 标准模板/条款库对比
  -> 语义规则模型调用
  -> 风险聚合与去重
  -> 二次校验与输出 schema 校验
  -> RiskFinding / ReviewEvidence / CommentPatchDraft
```

### 3.1 结构化规则
- 数值比较：付款比例、账期、质保金、违约金上限。
- 关键词/正则：主体、收款方、税率、版本、部署形态。
- 存在性检查：必备条款缺失、争议解决缺失、变更流程缺失。
- 输出必须包含：`rule_id`, `rule_code`, `rule_version`, `evidence`, `actual_value`, `expected_value`。

### 3.2 标准模板与条款库对比
- 先识别合同类型、部署形态、授权模式、交易场景。
- 选择适用的标准模板和条款集合。
- 对比客户合同与标准条款，输出匹配、轻微偏离、重大偏离、缺失。
- 结果必须保留 `template_reference`，不能只输出自然语言描述。

### 3.3 语义规则
- 语义规则只能在 `SkillBundle` 约束下调用模型。
- Prompt 必须由规则、模板、输出 schema 和模型策略组合生成。
- 模型输出必须通过 schema 校验；失败时降级为人工复核风险，不得伪造通过。

### 3.4 风险聚合
- 同一证据、同一规则、同一条款只保留一个主风险。
- 规则风险优先级高于通用模型建议。
- 高风险不得被低置信度模型结果自动降级。
- 每个 `RiskFinding` 必须能追溯到规则、模板、证据或模型调用。

### 3.5 历史 Skill 资产摘录

从 `F005-derive.md` 摘录到 F006 的内容，只作为运行时能力输入，不作为旧流程整体复刻：

| 历史资产 | F006 处理方式 |
|----------|---------------|
| ONES 单可信源原则 | `SkillBundle` 必须绑定规则、模板、条款库、输出 schema 和模型策略的不可变快照 |
| 模板选择逻辑 | 按合同类型、部署形态、授权模式、交易场景选择 `TemplateSnapshot` |
| 标准合同对照 | 输出匹配、轻微偏离、重大偏离、缺失，并保留 `template_reference` |
| 变体词典 | 作为 `variant_dictionary_snapshot_id` 输入，用于识别部署、授权、产品、法律和财务术语 |
| 二次验证 | 输出前检查位置引用、原文摘要、数值、风险描述、修改建议和引申发散 |
| eval 回归 | 与 F009 的测试用例合并，作为 Skill 发布前门禁 |

第一阶段必须预留以下知识资产引用，但不得写死到业务代码：

| 资产 | 运行时引用 |
|------|------------|
| 12 个标准合同模板 | `template_snapshot_ids` |
| 条款库 | `template_references[].clause_id` |
| 标准话术和让步梯度 | `RiskFinding.suggestion`、`NegotiationTask.script` |
| 产品/部署/授权变体 | `variant_dictionary_snapshot_id` |
| 案例库和业务实操 | `ReviewEvidence.template_references` 或后续知识引用 |

不复用的旧逻辑：
- 不复刻自由 agent 的 SKILL.md 执行方式。
- 不用“默认最严格”替代明确的规则判断；判不出关键授权或部署时应生成强风险并要求人工复核。
- 不把 ASK 表作为审核主对象；F006 输出 `RiskFinding`、`ReviewEvidence` 和 `CommentPatchDraft`。
- 不让模型凭通用 prompt 直接给最终结论。

---

## 4. 运行时对象

```ts
interface SkillBundle {
  id: string
  version: number
  org_id: string
  status: 'draft' | 'published' | 'compiled' | 'archived'
  rule_snapshot_ids: string[]
  template_snapshot_ids: string[]
  variant_dictionary_snapshot_id?: string
  output_schema: Record<string, unknown>
  model_policy_id: string
  eval_case_ids: string[]
}

interface ReviewEvidence {
  review_run_id: string
  skill_bundle_id: string
  rule_snapshot_ids: string[]
  template_references: Array<{
    template_id: string
    template_version: string
    clause_id?: string
  }>
  model_invocation_ids: string[]
}

interface RiskFinding {
  id: string
  review_run_id: string
  rule_id?: string
  rule_code?: string
  rule_version?: number
  level: 'red' | 'yellow' | 'green' | 'white'
  status: 'detected' | 'needs_owner_review' | 'needs_negotiation' | 'resolved' | 'waived' | 'escalated'
  evidence: {
    snippets: string[]
    start_offset?: number
    end_offset?: number
    clause_ref?: string
    template_reference?: string
  }
  suggestion: string
  owner_role?: string
  owner_id?: string
}
```

---

## 5. API 草案

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/contract-skills/compile` | 从已发布规则、模板、模型策略编译 SkillBundle |
| `GET` | `/api/contract-skills/published` | 获取当前组织可用 SkillBundle |
| `POST` | `/api/contract-skills/:id/evaluate` | 对测试合同运行回归测试 |
| `POST` | `/api/contracts/:id/review-runs` | 创建 ReviewRun 并绑定 SkillBundle |
| `GET` | `/api/contracts/:id/review-runs/:runId/evidence` | 查询审核依据与模型调用证据 |

---

## 6. 现有资产复用

优先复用：
- `contract_rules_v2`
- `contract_rule_snapshots`
- `contract_risk_cards`
- `contract_clauses`
- `clause_library`
- `knowledge_pages`
- `lib/rules/engine.ts`
- `lib/rules/flexible-engine.ts`
- `lib/contract-analysis.ts`
- `lib/ai/failover.ts`

需要改造：
- 现有 `lib/agent/skills/contract-review.ts` 只能作为历史概念参考，不能作为最终 SkillBundle。
- `/api/contracts/[id]/compare-standard` 的简单文本包含对比不能作为模板对比终态。
- 审核结果需要从“规则输出数组”升级为 `ReviewRun + RiskFinding + ReviewEvidence`。

### 6.1 第一阶段实现状态（2026-07-01）

当前阶段已经从“证据适配层”推进到真实运行对象：

- `contract_skill_bundles`：由已发布 `contract_rules_v2`、`contract_rule_snapshots`、`clause_library` 引用、输出 schema 和当前 `model_policy_id` 编译得到；使用内容 hash 去重，避免重复生成同一运行包。
- `contract_reviews.skill_bundle_id`：每次初审和再审核都会绑定真实 SkillBundle id。
- `contract_reviews.rule_snapshot_ids`：每次审核运行记录当次消费的规则快照 id，后续规则变更不影响历史 ReviewRun。
- `contract_reviews.model_policy_id` / `model_invocation_ids`：F006 执行时消费 F012 发布策略，并把模型/规则兜底调用审计写回 ReviewRun。
- `GET /api/contracts/:id/review`：审核工作台读取 ReviewRun 绑定的 SkillBundle、RuleSnapshot、ModelPolicy、ModelInvocation，而不是按当前表状态临时合成。

仍未关闭的后续项：

- 独立 `POST /api/contract-skills/compile` 和 `GET /api/contract-skills/published` API 尚未产品化。
- `template_snapshot_ids` 当前以条款库引用为主，标准合同模板快照、变体词典快照和 eval case 门禁尚未完整建模。
- 第一阶段 ReviewRun 可追溯规则/Skill/模型依据，但还不是完整商业产品形态的 Skill 编辑、模拟、发布、回滚控制台。

---

## 7. 验收标准

- [x] 已发布规则、条款库引用和模型策略能编译成第一阶段 `SkillBundle`
- [x] `SkillBundle` 有版本、状态、适用范围和发布审计字段
- [x] `ReviewRun` 必须绑定 `SkillBundle`，不允许无版本通用审核
- [x] 风险项必须包含规则/模板/模型依据之一
- [ ] 模板对比结果能说明匹配、偏离、缺失和引用来源
- [ ] 模型输出不符合 schema 时进入人工复核，不伪装成功
- [x] F007 能消费 F006 输出的 `CommentPatchDraft`
- [x] 历史 ReviewRun 可查看其当时使用的规则、SkillBundle 和模型策略
