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
| `rule_set_snapshot_ids` | F009 | 已发布规则集快照，冻结规则集版本、规则快照集合和规则集发布状态 |
| `document_snapshot_ids` | F009 | 规则集声明文档快照，冻结 Markdown/自然语言声明资产和转译状态 |
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
- 当 F009 的配置中心规则发布新 `RuleSnapshot` 后，新建或再审核的 `ReviewRun` 必须重新计算 `SkillBundle.compiled_hash`；若快照集合变化，不得继续复用旧 current bundle。`ones-internal-skills` 等 GitHub 资产只能作为参考导入、模板和 eval 样例，不能作为生产规则源头。

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
  key: 'CONTRACT_REVIEW_DEFAULT' | string
  is_current: boolean
  rule_snapshot_ids: string[]
  rule_set_snapshot_ids: string[]
  template_snapshot_ids: string[]
  document_snapshot_ids: string[]
  variant_dictionary_snapshot_id?: string
  output_schema: {
    schema_version: 'f006.review.v1'
    required_outputs: Array<'risk_findings' | 'negotiation_tasks' | 'review_evidence' | 'comment_patch_drafts' | 'report_summary'>
    review_run_binding: Record<string, unknown>
    risk_finding: Record<string, unknown>
    negotiation_task: Record<string, unknown>
    comment_patch_draft: Record<string, unknown>
    report_summary: Record<string, unknown>
    validation: Record<string, unknown>
  }
  model_policy_id: string
  eval_case_ids: string[]
  compiled_from: {
    product_phase: 'contract_review_first_stage'
    production_rule_source: {
      owner: 'F009'
      source_of_truth: 'config_center_published_rules'
      rules_table: 'contract_rules_v2'
      snapshot_table: 'contract_rule_snapshots'
    }
    execution_plan: string[]
    rules: Array<Record<string, unknown>>
    rule_units: Array<Record<string, unknown>>
    rule_translation_gate: Record<string, unknown>
    rule_sets: Array<Record<string, unknown>>
    rule_set_documents: Array<Record<string, unknown>>
    rule_set_document_gate: Record<string, unknown>
    template_references: Array<Record<string, unknown>>
    reference_assets: Array<Record<string, unknown>>
    model_policy: Record<string, unknown>
  }
  release_meta: Record<string, unknown>
  compiled_hash: string
}

interface ReviewEvidence {
  review_run_id: string
  skill_bundle_id: string
  rule_snapshot_ids: string[]
  rule_set_snapshot_ids: string[]
  rule_set_document_ids: string[]
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
| `POST` | `/api/contract-policies/rules/:id/translate` | 生成配置中心规则的 AI 转译草稿，不直接发布 |
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
- `contract_skill_bundles.compiled_from.production_rule_source`：记录生产规则源为 F009 配置中心发布规则，即 `contract_rules_v2` + `contract_rule_snapshots`；这是审核依据的唯一运行时事实源。
- `contract_skill_bundles.compiled_from.reference_assets`：记录 `suoyidev/ones-internal-skills` / `ones-contract-assistant` 的 repo、commit、version 和 references，仅作为导入参考、模板素材和 eval 样例，不得被页面或模型提示展示为生产规则来源。
- `contract_skill_bundles.compiled_from.rule_units` / `rule_translation_gate`：把已发布规则转译为 `RuleUnit`，并记录是否达到 `ready`。缺少 `semantic_prompt`、`message_template`、证据要求或发布快照时，状态必须为 `needs_ai_translation` / `incomplete_source`，ReviewRun 只能显示为降级或需复核。
- 结构化 `message_template` 不要求只有单段自然语言；`levels + outputs` 这样的规则集结构化模板可作为可执行模板，但单纯 `source` 元数据不能通过转译门禁。
- `contract_skill_bundles.compiled_from.rule_sets` / `rule_set_documents` / `rule_set_document_gate`：F006 必须把规则集资产和最新发布文档一起冻结。缺少发布文档或文档转译未 ready 时，SkillBundle 不能成为正式审核引擎。
- F006 编译输入只允许读取 `contract_rules_v2.lifecycle_status='published'`、`translation_status='ready'` 且存在 `published_at` 的规则；编译过程不得自动创建 `published` 快照。缺少已发布快照时，`rule_translation_gate` 必须失败或降级，不能把草稿规则伪装成正式审核引擎。
- `is_active` 不是正式发布口径。F006 正式执行门禁必须按 `is_active=true + lifecycle_status='published' + translation_status='ready' + published_at` 判定；底层 `rule-engine`、语义审核入口、规则统计和 ReviewRun 证据回退查询都必须使用同一口径。若 SkillBundle 未达到 `published/current/translation ready/eval passed`，语义模型不得运行，ReviewRun 必须记录降级原因。
- AI 转译是草稿动作：它可以补全 `semantic_prompt`、`field_hints`、`message_template`、谈判动作和批注模板，但不能发布规则，也不能改变规则编码、阈值和生产来源。只有人工确认并通过发布 API 的快照才能进入 `SkillBundle`。
- `contract_skill_bundles.compiled_from.eval_results`：第一阶段必须区分两类 gate：`static_eval_status` 表示配置中心发布规则、RuleUnit 完整性、已发布快照和输出 schema 绑定是否通过；`runtime_eval_status` 表示真实模型质量 eval 是否运行。静态发布检查通过可以让 SkillBundle 成为第一阶段可运行引擎，但如果没有真实执行 runtime/model-quality eval，`runtime_eval_status` 必须标记为 `model_quality_eval_not_run`，并在 ReviewRun 证据中展示为未验收，不能写成模型质量全部通过。
- `runtime_eval_status` 必须区分调用通道：`latest_review_model_invocation_passed` 只允许来自 `semantic_review` 且 `transport=openai_compatible_http`、无降级、无剔除风险、无校验警告的调用；`transport=lm_studio_cli` 只能标记为本机模型执行证据，不能作为 HTTP 接入或线上模型链通过证据。
- 长合同、长 PDF 的 `semantic_review` 不是普通本地优先场景：当文本超过本地模型页数阈值或 20,000 字符时，F006 必须通过 F012 选择支持 `tender_long_document_parse` 的 L2 云端 OpenAI-compatible Provider；`model_invocations.request_meta` 必须记录 `provider_selection_reason`、`text_length`、`estimated_page_count`、`long_contract_cloud_required`，`response_meta.input_stats` 必须记录提交字符数、chunk 数和覆盖率。没有云端 Provider、云端不可用或输入覆盖不完整时，ReviewRun 必须降级，不能展示为正式 AI 审核完成。
- `contract_reviews.skill_bundle_id`：每次初审和再审核都会绑定真实 SkillBundle id。
- `contract_reviews.rule_snapshot_ids`：每次审核运行记录当次消费的规则快照 id，后续规则变更不影响历史 ReviewRun。
- `contract_reviews.rule_set_snapshot_ids` / `rule_set_document_ids`：每次审核运行记录当次消费的规则集快照和规则集文档，证明审核依据不是散落代码规则。
- `contract_reviews.model_policy_id` / `model_invocation_ids`：F006 执行时消费 F012 发布策略，并把模型/规则兜底调用审计写回 ReviewRun。
- `GET /api/contracts/:id/review`：审核工作台读取 ReviewRun 绑定的 SkillBundle、RuleSnapshot、ModelPolicy、ModelInvocation，而不是按当前表状态临时合成。

仍未关闭的后续项：

- 独立 `POST /api/contract-skills/compile` 和 `GET /api/contract-skills/published` API 尚未产品化。
- `template_snapshot_ids` 当前以条款库引用为主，标准合同模板快照、变体词典快照和 eval case 门禁尚未完整建模。
- `ones-internal-skills` 的 eval case 已作为参考评测资产记录，但尚未形成可自动运行、可阻断发布的回归门禁。
- 第一阶段 ReviewRun 可追溯规则/Skill/模型依据，但还不是完整商业产品形态的 Skill 编辑、模拟、发布、回滚控制台。
- 2026-07-02 本地验收样例：同一 ReviewRun 绑定 15 个 `RuleSnapshot`、13 个 `RuleSetSnapshot`、13 个 `RuleSetDocument`，SkillBundle v17 为 `published/current`；`semantic_review` 通过 `AI_LEVEL_1 / gpt-oss-20b / openai_compatible_http` 完成，未降级。该样例证明链路可运行，不代表模型质量 eval 已完成。

---

## 7. 验收标准

- [x] 已发布规则、条款库引用和模型策略能编译成第一阶段 `SkillBundle`
- [x] `SkillBundle` 有版本、状态、适用范围和发布审计字段
- [x] `ReviewRun` 必须绑定 `SkillBundle`，不允许无版本通用审核
- [x] 风险项必须包含规则/模板/模型依据之一
- [ ] 模板对比结果能说明匹配、偏离、缺失和引用来源
- [x] 第一阶段静态发布门禁能验证配置中心发布规则、RuleUnit、快照和输出 schema 并生成可运行 SkillBundle
- [x] SkillBundle 能冻结 `RuleSet`、`RuleSetDocument`、`RuleSnapshot` 并在 ReviewRun 中回写绑定 ids
- [x] 正式审核只加载 `published + ready + published_at` 的规则，未发布或未转译规则不会被底层规则引擎或语义审核伪装为正式依据
- [ ] 参考 eval case 能真实运行并作为模型质量门禁；未运行时 ReviewRun 必须显示 `model_quality_eval_not_run`
- [x] 模型输出不符合 Skill schema、缺少规则编号或缺少原文证据时进入降级/人工复核，不伪装成功
- [x] F007 能消费 F006 输出的 `CommentPatchDraft`
- [x] 历史 ReviewRun 可查看其当时使用的规则、SkillBundle 和模型策略
- [x] RiskFinding、CommentPatch 和导出链路使用同一问题 ID、规则快照、风险等级和证据；缺少原文定位时标记人工定位
