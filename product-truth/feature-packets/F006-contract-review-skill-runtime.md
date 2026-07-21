# Feature Packet: F006-合同审核 Skill 运行时

**REQ ID**: F006
**Status**: confirmed
**Parent**: 合同审核 / 配置中心消费侧
**Depends On**: `F005v2-contract-center`, `F009-contract-rule-config`, `F012-ai-runtime-config`
**Consumed By**: `F005` 合同中心, `F007` Word 批注导出

---

## 1. 单元定义

**目标**：把配置中心当前发布的不可变规则集快照、知识库/模板引用和输出 schema 编译成可运行、可追溯、可回放的 `SkillBundle`，供合同审核运行消费。平台 AI 执行计划由每次 `ReviewRun` 另行绑定，不能混入规则技能包。

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
| `rule_snapshot_ids` | F009 | 当前规则集快照精确引用的 canonical 规则快照；每条快照冻结问题分类、业务属性、判定与处理 |
| `rule_set_snapshot_ids` | F009 | 已发布规则集快照，冻结规则集版本、规则快照集合和规则集发布状态 |
| `document_snapshot_ids` | F009 | 可选规则参考文档；用于解释与追溯，不替代结构化规则，也不是规则集发布前置条件 |
| `template_snapshot_ids` | 知识库/模板库 | 标准合同模板、条款模板、案例、话术 |
| `variant_dictionary_snapshot_id` | 知识库/词典 | 产品、部署、授权、法律、财务术语变体 |
| `output_schema` | F006 | 风险项、证据、批注意图、报告摘要的结构约束 |
| `output_schema.review_run_binding` | F006/F012 | 强制每次 ReviewRun 绑定由业务用点与已发布 RoutePolicy 解析得到的 `plan_snapshot_id/hash` 和 `model_invocation_ids`；执行计划是运行事实，不固化为 SkillBundle 顶层字段，也不写进规则 |
| `eval_case_ids` | F009/F006 | 发布前回归测试用例 |
| `release_meta` | F006 | 发布人、发布时间、适用范围、版本说明 |

### 2.1 状态与独立事实

`SkillBundle.status` 只使用 `draft | compiled | published | archived`，不能把测试、绑定或运行阶段伪装成数据库状态：

- `draft`：人工维护中的技能包，不可被正式审核消费。
- `compiled`：已按当前输入内容寻址生成，但规则快照/验收门禁不完整；必须 `is_current=false`，只能作为失败或降级证据。
- `published`：current RuleSetSnapshot、canonical RuleSnapshot 与规则验收矩阵全部有效；可成为新 ReviewRun 的规则技能输入。
- `archived`：不再供新审核选择，但历史 ReviewRun 仍可按显式 ID 回放。

下列事实必须独立记录，不属于上述状态迁移：

- `rule_acceptance_status`：当前不可变规则集快照冻结的确定性规则测试矩阵。
- `model_quality_eval_status`：基于独立金标的模型质量验收；可以在规则已发布时仍保持阻断。
- `ReviewRun` 绑定：运行开始时绑定 `SkillBundle`、`plan_snapshot_id/hash` 和后续 `model_invocation_ids`；后续规则或模型配置变化不能影响历史结果。
- 当 F009 原子发布新的 `RuleSetSnapshot` 后，新建或再审核的 `ReviewRun` 必须重新计算 `SkillBundle.compiled_hash`；若快照集合变化，不得继续复用旧 current bundle。相同 `org_id + key + compiled_hash` 的 compiled bundle 必须内容寻址复用，不能因降级运行反复插入重复包。`ones-internal-skills` 等 GitHub 资产只能作为参考导入、模板和 eval 样例，不能作为生产规则源头或发布证据。

---

## 3. 审核执行管线

```
ContractVersion
  -> 文本/结构归一化
  -> 合同类型与模板匹配
  -> AI/确定性能力定位规则所需原文并读取 typed value/unit/evidence
  -> 服务端按发布快照确定性执行判定
  -> 标准模板/条款库对比
  -> 语义规则模型调用
  -> 风险聚合与去重
  -> 二次校验与输出 schema 校验
  -> RiskFinding / ReviewEvidence / CommentPatchDraft
```

### 3.1 canonical 规则执行
- 配置事实固定为 `规则集 → 问题分类 → 具体规则 → 规则详情 → 业务属性 → 判定与处理`。
- 金额、比例、时限、日期、枚举、布尔、数字和文本由业务人员明确配置类型、单位、运算符、阈值、结果和动作；不存在配置期“属性提取”或机器 Prompt。
- AI 或确定性定位器只提交 `property_key + typed value + unit + evidence + confidence`，不得创建属性、选择判定、改写风险等级或自由生成处理动作。
- 服务端校验类型、单位、证据和冲突后，按已发布 `rule_contract v1` 确定性计算；缺值、单位冲突或证据冲突进入规则声明的 missing-evidence 结果。
- 输出必须包含：`rule_id`, `rule_code`, `rule_version`, `rule_snapshot_id`, `decision_id`, `evidence`, `actual_value`, `expected_value`。

### 3.2 标准模板与条款库对比
- 先识别合同类型、部署形态、授权模式、交易场景。
- 选择适用的标准模板和条款集合。
- 对比客户合同与标准条款，输出匹配、轻微偏离、重大偏离、缺失。
- 结果必须保留 `template_reference`，不能只输出自然语言描述。

### 3.3 AI 属性读取
- AI 只能通过平台业务用点和不可漂移执行计划调用；模型、Provider、Key 与降级顺序由 F012 管理，F009 规则不承载这些配置。
- 模型任务是定位原文并读取发布规则需要的 typed facts；请求必须包含精确规则/属性 schema，响应必须通过服务端 schema、类型、单位和原文证据校验。
- 模型读取失败、证据不足或相互冲突时进入规则自己的 missing-evidence/人工复核路径，不得由模型猜测最终风险或伪造通过。
- 每次正式运行必须写入 `model_invocations`、token、Provider/模型、降级轨迹，并由 ReviewRun 绑定 `plan_snapshot_id`、`plan_snapshot_hash` 和 `model_invocation_ids`。

### 3.4 风险聚合
- 同一证据、同一规则、同一条款只保留一个主风险。
- 规则风险优先级高于通用模型建议。
- 高风险不得被低置信度模型结果自动降级。
- 每个 `RiskFinding` 必须能追溯到规则、模板、证据或模型调用。

### 3.5 历史 Skill 资产摘录

从 `F005-derive.md` 摘录到 F006 的内容，只作为运行时能力输入，不作为旧流程整体复刻：

| 历史资产 | F006 处理方式 |
|----------|---------------|
| ONES 单可信源原则 | `SkillBundle` 必须绑定规则、模板/知识引用和输出 schema 的不可变快照；`ReviewRun` 再独立绑定平台执行计划快照 |
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
    rule_set_snapshot_gate: Record<string, unknown>
    eval_results: {
      rule_acceptance_status: 'passed' | 'failed' | 'not_run'
      model_quality_eval_status: 'passed' | 'failed' | 'blocked_without_independent_gold' | 'not_run'
      total_rules: number
      passed_rules: number
      total_cases: number
      passed_cases: number
    }
    rule_sets: Array<Record<string, unknown>>
    rule_set_documents: Array<Record<string, unknown>>
    rule_set_document_gate: Record<string, unknown> // optional references only
    template_references: Array<Record<string, unknown>>
    reference_assets: Array<Record<string, unknown>>
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
  plan_snapshot_id: string
  plan_snapshot_hash: string
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
| `POST` | `/api/contract-skills/compile` | 从当前已发布规则集快照、模板/知识引用和输出 schema 编译 SkillBundle |
| `GET` | `/api/contract-skills/published` | 获取当前组织可用 SkillBundle |
| `POST` | `/api/contract-skills/:id/evaluate` | 对测试合同运行回归测试 |
| `POST` | `/api/contracts/:id/review-runs` | 创建 ReviewRun 并绑定 SkillBundle |
| `GET` | `/api/contracts/:id/review-runs/:runId/evidence` | 查询审核依据与模型调用证据 |

不存在规则 AI 转译 API。规则草稿只能由 F009 canonical 控制面保存和测试，并随完整规则集原子发布；任何旧 translate/单规则发布入口必须失败关闭。

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

- `contract_skill_bundles`：由当前 `RuleSetSnapshot` 精确引用的 canonical `RuleSnapshot`、可选知识资产引用和输出 schema 编译得到；使用内容 hash 与数据库唯一身份复用相同 compiled bundle，避免降级运行反复生成重复包。不可漂移 AI 执行计划只在 `ReviewRun` 中独立绑定。
- `contract_skill_bundles.compiled_from.production_rule_source`：记录生产规则源为 F009 配置中心发布规则，即 `contract_rules_v2` + `contract_rule_snapshots`；这是审核依据的唯一运行时事实源。
- `contract_skill_bundles.compiled_from.reference_assets`：记录 `suoyidev/ones-internal-skills` / `ones-contract-assistant` 的 repo、commit、version 和 references，仅作为导入参考、模板素材和 eval 样例，不得被页面或模型提示展示为生产规则来源。
- `contract_skill_bundles.compiled_from.rule_units` 只是在运行期表达发布规则需要读取的属性、证据 schema 和确定性判定合同；不得从 `semantic_prompt`、`field_hints`、旧 Level A/B/C 或参考文档“转译”出新的业务含义。
- `contract_skill_bundles.compiled_from.rule_sets` 必须来自 live RuleSet 的唯一 `current_snapshot_id` 所指向的 immutable published snapshot。live row 的 `ready_to_publish` 只表示另有草稿，不能让当前线上快照从运行时消失。
- 每个被引用的 RuleSnapshot 必须同时验证 org、rule、RuleSet、version、active、problem_category_id 和 canonical `rule_contract v1`；任一冲突都失败关闭，不能用 live row 或 legacy adapter 修补历史快照。
- `rule_set_documents` 是可选解释/参考资产。存在引用时应冻结并校验；不存在时不能阻断结构化规则集发布，也不能替代 canonical 规则详情。
- `compiled_from.eval_results.rule_acceptance_status` 只由当前 RuleSetSnapshot 冻结的逐规则完整验收矩阵决定。验收运行绑定规则发布前的 accepted draft snapshot；发布快照在 `_release_evidence.accepted_draft_snapshot_id` 中保存证据链，二次发布可复用未改规则的精确验收，变更规则必须重测。
- `model_quality_eval_status` 与规则验收完全分开。没有独立金标和同一真实合同的多模型对比时必须保持 `blocked_without_independent_gold`/`not_run`；规则矩阵通过、Provider probe 成功或一次 ReviewRun 均不能冒充模型准确率通过。
- `runtime_invocation_status` 必须区分调用通道：`latest_review_model_invocation_passed` 只允许来自 `semantic_review` 且 `provider_kind=openai_compatible`、`transport=openai_compatible_http`、无降级、token 为 Provider 原始计数、输出校验通过，并显式记录 `validation_item_kind=risk`、`validation_warnings=[]`、`dropped_risk_count=0` 的调用；缺少任一审计字段必须失败关闭，不能默认当作零。`transport=lm_studio_cli` 只能标记为本机模型执行证据，不能作为 HTTP 接入、线上模型链或模型质量金标通过证据。
- 长合同、长 PDF 的 `semantic_review` 不是普通本地优先场景：当文本超过本地模型页数阈值或 20,000 字符时，F006 必须通过 F012 选择支持 `tender_long_document_parse` 的 L2 云端 OpenAI-compatible Provider；`model_invocations.request_meta` 必须记录 `provider_selection_reason`、`text_length`、`estimated_page_count`、`long_contract_cloud_required`，`response_meta.input_stats` 必须记录提交字符数、chunk 数和覆盖率。没有云端 Provider、云端不可用或输入覆盖不完整时，ReviewRun 必须降级，不能展示为正式 AI 审核完成。
- `contract_reviews.skill_bundle_id`：每次初审和再审核都会绑定真实 SkillBundle id。
- `contract_reviews.rule_snapshot_ids`：每次审核运行记录当次消费的规则快照 id，后续规则变更不影响历史 ReviewRun。
- `contract_reviews.rule_set_snapshot_ids` / `rule_set_document_ids`：每次审核运行记录当次消费的规则集快照和规则集文档，证明审核依据不是散落代码规则。
- `contract_reviews.plan_snapshot_id` / `plan_snapshot_hash` / `model_invocation_ids`：F006 执行时消费 F012 发布路由解析出的不可漂移计划，并把 Provider、模型、token、降级和规则兜底调用审计写回 ReviewRun；旧 `model_policy_id` 只能作为兼容字段，不能满足新运行门禁。
- `GET /api/contracts/:id/review`：审核工作台读取 ReviewRun 绑定的 SkillBundle、RuleSnapshot、执行计划和 ModelInvocation，而不是按当前 live 表状态临时合成。

仍未关闭的后续项：

- 独立 `POST /api/contract-skills/compile` 和 `GET /api/contract-skills/published` API 尚未产品化。
- `template_snapshot_ids` 当前以条款库引用为主，标准合同模板快照、变体词典快照和 eval case 门禁尚未完整建模。
- `ones-internal-skills` 的 eval case 已作为参考评测资产记录，但尚未形成可自动运行、可阻断发布的回归门禁。
- 第一阶段 ReviewRun 可追溯规则/Skill/模型依据，但还不是完整商业产品形态的 Skill 编辑、模拟、发布、回滚控制台。
- 2026-07-02 本地验收样例：同一 ReviewRun 绑定 15 个 `RuleSnapshot`、13 个 `RuleSetSnapshot`、13 个 `RuleSetDocument`，SkillBundle v17 为 `published/current`；`semantic_review` 通过 `AI_LEVEL_1 / gpt-oss-20b / openai_compatible_http` 完成，未降级。该样例证明链路可运行，不代表模型质量 eval 已完成。

---

## 7. 验收标准

- [x] 当前 RuleSetSnapshot 精确引用的 canonical 规则、可选知识资产和输出 schema 能编译成第一阶段 `SkillBundle`；执行计划由 ReviewRun 独立绑定
- [x] `SkillBundle` 有版本、状态、适用范围和发布审计字段
- [x] `ReviewRun` 必须绑定 `SkillBundle`，不允许无版本通用审核
- [x] 风险项必须包含规则/模板/模型依据之一
- [ ] 模板对比结果能说明匹配、偏离、缺失和引用来源
- [x] 规则验收门禁能验证 current RuleSetSnapshot、canonical RuleSnapshot、accepted-draft 测试矩阵和输出 schema；参考样例或 translation ready 不能冒充验收通过
- [x] SkillBundle 能冻结 `RuleSetSnapshot`、可选 `RuleSetDocument` 和 `RuleSnapshot`；ReviewRun 独立冻结平台 AI 执行计划并回写双方的绑定 ids/hash
- [x] 正式审核只加载 current pointer 指向的有效 immutable published snapshots；未发布草稿、无 canonical rule_contract 或快照冲突均失败关闭，控制面新草稿不影响旧线上版本运行
- [ ] 独立金标 eval 能真实运行并作为模型质量门禁；未完成时 `model_quality_eval_status` 必须保持 `blocked_without_independent_gold`/`not_run`，ReviewRun 另行显示本次 `runtime_invocation_status`
- [x] 模型输出不符合 Skill schema、缺少规则编号或缺少原文证据时进入降级/人工复核，不伪装成功
- [x] F007 能消费 F006 输出的 `CommentPatchDraft`
- [x] 历史 ReviewRun 可查看其当时使用的规则、SkillBundle、执行计划和模型调用
- [x] RiskFinding、CommentPatch 和导出链路使用同一问题 ID、规则快照、风险等级和证据；缺少原文定位时标记人工定位
