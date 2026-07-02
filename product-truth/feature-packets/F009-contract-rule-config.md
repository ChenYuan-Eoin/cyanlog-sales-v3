# Feature Packet: F009-合同审核规则配置

**Created**: 2026-06-25  
**REQ ID**: F009  
**Status**: confirmed  
**Parent**: 配置中心  
**Depends On**: `F000-config-center-architecture`  
**Consumed By**: `F006` 合同审核 Skill 运行时, `F005` 合同中心

---

## 1. 单元定义

**目标**：在配置中心产品化维护合同审核运行所需的规则资产，让合同审核页只消费已发布规则，不在业务执行页临时修改规则。

规则资产产品化不等于把复杂规则拆成难用表单，也不等于让用户输入一段 Markdown 后由系统黑盒解析。F009 必须同时提供两种可维护视图：

| 视图 | 作用 | 约束 |
|------|------|------|
| 规则集目录视图 | 像知识库树一样管理红绿灯规则、逻辑审查、合同对比、付款、税率、验收、IP、数据安全等规则集 | 能看到规则集层级、规则数量、发布状态、适用范围和阻断原因 |
| 规则结构化视图 | 维护单条规则的编码、名称、分类、执行引擎、触发条件、风险条件、例外条件、证据要求、谈判动作、批注模板、测试用例 | 所有字段可见、可编辑、可测试、可发布，不允许黑盒转译 |
| 文档/Markdown 视图 | 高效批量维护规则声明、导入外部参考、对齐历史规则资产 | 只能作为输入来源或对照视图，转译结果必须回写到结构化视图并经人工确认 |

**这包拥有的内容**：
- 规则集目录、规则集文档和规则集版本
- 合同审核结构化规则
- 合同审核语义规则
- 规则启用/禁用、优先级、严重等级
- 规则版本、发布、回滚、审计
- 规则测试沙箱和模拟审核入口
- 风险消息模板、整改建议、法规/条款引用
- 规则与标准模板、条款库、话术库、测试用例的引用关系
- 发布给 F006 编译 SkillBundle 的规则快照

**这包不拥有的内容**：
- 合同上传、解析、审核结果展示（属于 `F005`）
- Skill 编译、规则执行内核、风险聚合算法（属于 `F006`）
- AI Provider、模型路由、降级策略（属于 `F012`）
- 组织架构、角色权限、数据范围（属于 `F011`）

---

## 2. 三层落位

| 层级 | 本功能对应物 |
|------|--------------|
| 第一层：能力域 | 合同审核规则配置 |
| 第二层：具体配置 | 结构化规则、语义规则、版本、生效状态、测试用例 |
| 第三层：消费页面 | F006 Skill 编译、合同上传/审核页、审核报告页、风险任务 |

---

## 3. 配置对象

### 3.0 规则集资产

规则集是 F009 的一级资产，不是单条规则列表的分组标签。

| 对象 | 说明 |
|------|------|
| `RuleSet` | 规则集，如红绿灯规则、逻辑审查、合同对比、付款条款、税率自检、验收、IP、数据安全、SLA、争议解决 |
| `RuleSetDocument` | 规则集的 Markdown/自然语言声明、历史参考、外部导入素材和维护说明 |
| `RuleUnit` | 规则集下的一条可执行规则，具备结构化字段和运行约束 |
| `RuleSetSnapshot` | 发布时冻结规则集、规则、文档、模板引用和测试结果 |

规则集页面应采用三栏：

| 栏位 | 内容 | 目标 |
|------|------|------|
| 左栏：规则集树 | 规则集目录、规则数量、发布/草稿/阻断状态 | 一眼知道当前规则资产版图 |
| 中栏：规则清单 | 当前规则集下的规则、风险等级、引擎、适用范围、测试状态 | 一眼知道规则集是否可运行 |
| 右栏：规则详情闭环 | 结构化字段、约束条件、AI 转译差异、测试沙盒、发布阻断、引用模板 | 能完成编辑、验证、发布或回滚 |

AI 转译必须是可解释动作：输入可以来自 Markdown/历史规则/外部参考，但输出必须展示为字段级 diff，例如 `trigger_conditions`、`risk_conditions`、`exception_conditions`、`evidence_requirements`、`negotiation_action`、`comment_template`。用户确认前不得进入正式 `SkillBundle`。

### 3.1 结构化规则
- 规则编码，如 `R001` 至 `R015`
- 规则名称、分类、优先级
- 检测类型：数值比较、关键词、正则、存在性/缺失性
- 阈值、单位、适用合同类型
- 风险等级：红 / 黄 / 绿
- 消息模板、修改建议、引用依据

### 3.2 语义规则
- 自然语言审核标准
- 期望输出结构
- 适用章节 / 条款范围
- 规则触发后的风险映射

### 3.3 版本与发布
- 草稿保存生成新版本
- 发布版本才被合同审核消费
- 回滚生成新版本，不直接覆盖历史
- 已开始审核的合同使用当时规则快照

### 3.4 测试与模拟
- 单规则测试
- 批量规则模拟
- 测试文本输入
- 命中结果、执行耗时、预期对比

### 3.5 Skill 转译输入

F009 发布的规则必须能被 F006 编译为 `SkillBundle`。因此每条规则除“如何展示”外，还必须具备运行时输入：

| 字段 | 说明 |
|------|------|
| `rule_code` / `version` | 稳定编码和版本 |
| `business_domain` | 业务域，第一阶段默认为 `contract_review`，后续可扩展到报价、续约、交付 |
| `risk_level` | 规则默认风险等级：`green` / `yellow` / `red` |
| `applicable_scenarios` | 适用场景，如标准合同审核、续约审核、客户回传版本审核；不能为空 |
| `scope` | 规则作用域：`org` / `dept` / `user`，决定发布规则在哪个组织范围内生效 |
| `lifecycle_status` | 草稿、待转译、待发布、已发布、已归档 |
| `translation_status` | AI 转译草稿状态：未开始、待转译、就绪、失败 |
| `engine_type` | `structured` / `semantic` / `hybrid` |
| `target_field` | 结构化字段，如付款比例、账期、违约金 |
| `field_hints` | 解析和定位提示词 |
| `semantic_prompt` | 语义规则的审核标准，不是完整通用 prompt |
| `message_template` | 风险标题、描述、建议和批注文案模板 |
| `template_refs` | 关联标准合同模板或条款库 |
| `owner_role` | 默认处理角色，如销售、法务、财务、交付 |
| `negotiation_required` | 是否必须进入销售谈判任务 |
| `eval_cases` | 发布前必须通过的测试样例 |

### 3.6 历史规则资产摘录

从 `F005-derive.md` 摘录并纳入 F009 的规则资产如下：

| 资产 | 第一阶段处理 |
|------|--------------|
| 三级柔性阈值 | 每条结构化规则至少支持 `recommended`、`warning`、`red_line` 三类边界；红线阻塞、黄线进入复核或谈判 |
| 重叠规则集 | 同一规则维度可以按合同金额、客户类型、业务场景、销售资历配置多套适用范围，发布时必须能解释命中哪套规则 |
| 规则版本链 | 规则保存、发布、回滚都生成新版本；历史 `ReviewRun` 只看当时快照 |
| 规则测试沙箱 | 发布前支持单规则测试和批量回归；失败不得发布到 F006 |
| 命中率统计 | 统计触发率、等级分布、平均执行时间，用于后续运营优化，不作为第一阶段阻塞项 |
| 让步与话术 | 可作为 `message_template`、`negotiation_script`、`bottom_line` 字段，不写死在审核执行代码 |

第一阶段预置规则种子按 R001-R015 管理，编码稳定、内容可配置。生产规则源头只能是配置中心维护并发布的 `contract_rules_v2` / `RuleSnapshot`；`suoyidev/ones-internal-skills` 的 `ones-contract-assistant` 只能作为导入参考、模板素材和评测样例，不能覆盖系统内已发布规则，也不能在运行时被当作审核事实源。配置中心必须先按 `RuleSet` 展示，再在规则集内按 `clause_category`、`business_domain`、`risk_level`、`engine_type`、`target_field`、`field_hints`、版本、启用状态和发布状态展示规则，避免 R001-R015 被平铺成不可维护的规则清单。

保存规则不等于发布规则。保存只生成草稿版本和 `draft` 快照；AI 转译只允许补全 `target_field`、`clause_category`、`field_hints`、`semantic_prompt` 与 `message_template` 等运行字段，不能改写规则编码、阈值或发布状态。发布前必须校验 `business_domain`、`risk_level`、`applicable_scenarios`、`scope`、`clause_category`、`field_hints`、`message_template` 和对应引擎所需字段是否完整。未通过转译确认或发布校验的规则不得进入 F006 `SkillBundle`。

配置中心 UI 和 API 必须明确区分“启用、转译就绪、正式发布、可正式审核”。正式审核口径不是 `is_active`，而是 `is_active=true + lifecycle_status='published' + translation_status='ready' + published_at`。规则集目录、规则卡片、右侧运行摘要、规则统计 API 和审核详情证据必须使用同一套状态解释，避免把草稿、待转译规则或缺发布时间的规则展示为生产依据。

| 编码 | 名称 | 默认归属 | 关键判断 |
|------|------|----------|----------|
| R001 | 付款节奏 | 财务/销售 | 首付款比例、账期、付款触发条件 |
| R002 | 终止退款 | 法务 | 是否承诺退未消耗或全额退款 |
| R003 | 税率 | 财务 | 软件、订阅、服务税率是否错配 |
| R004 | 默示验收期 | 交付/法务 | 验收期限、默示通过条件是否过宽 |
| R005 | 验收不通过 | 交付/法务 | 整改次数、解除权、责任归属 |
| R006 | 违约金 | 法务/销售 | 违约金比例、单向责任、是否超红线 |
| R007 | 间接损失 | 法务 | 是否承担间接损失或扩大赔偿 |
| R008 | 责任上限 | 法务 | 责任 cap 是否超过合同金额或约定比例 |
| R009 | 保密期 | 法务 | 保密期限、范围、单向义务 |
| R010 | 主体/收款/金额 | 财务/销售 | 签约主体、收款主体、合同金额一致性 |
| R011 | 知识产权 | 法务/交付 | 产品 IP、二开成果、客户权利边界 |
| R012 | 数据安全 | 法务/交付 | 数据归属、训练授权、本地化、加密要求 |
| R013 | SLA | 交付/销售 | 可用性承诺、赔偿方式、服务边界 |
| R014 | 续约 | 销售/法务 | 自动续期、永久锁价、通知义务 |
| R015 | 争议解决 | 法务 | 管辖地、仲裁机构、境外争议 |

以上规则只是种子范围，不代表写死规则逻辑。最终审核依据必须来自配置中心发布的 `RuleSnapshot`。外部 skill 或 GitHub 规则更新时，只能进入“参考导入 / 差异评审 / eval 样例”流程；经人工确认后才可写入 `contract_rules_v2` 属性字段、`semantic_prompt` 和 `message_template` 并发布新快照。未变化的规则不得重复制造版本；保存、AI 转译、人工修正和发布必须保留各自版本与审计证据。

---

## 4. 数据建模原则

合同规则优先使用强类型表，不应只压进泛型 `configs`：
- `contract_rule_sets`
- `contract_rule_set_documents`
- `contract_rule_set_snapshots`
- `contract_rules_v2`
- `contract_rule_versions`
- `contract_rule_snapshots`
- `contract_rule_test_cases`
- `contract_rule_audit_logs`
- `contract_rule_template_refs`

MVP 可以继续兼容已有 `rules` / `configs` 数据，但必须满足：
- 规则有稳定编码和版本
- 已发布规则能被审核执行链读取
- 规则变更可追溯
- 预置规则可重复迁移而不重复插入

---

## 5. 消费映射

| 消费方 | 读取什么 | 写入什么 |
|--------|----------|----------|
| `F006` Skill 运行时 | 已发布规则快照、模板引用、测试用例 | SkillBundle 编译结果、规则命中结果 |
| `F005` 合同审核页 | F006 输出的风险事实 | 审核任务、风险卡片、谈判任务 |
| 审核报告页 | 风险等级、消息模板、建议 | 报告展示状态 |
| 风险任务链路 | 红/黄风险卡片、处理角色、谈判要求 | 复核任务、谈判任务 |

**硬边界**：合同中心可以触发审核和查看命中结果，但不能在合同页面修改规则配置。

**发布边界**：只有 `published` 规则快照能进入 F006 SkillBundle；草稿规则只能进入沙箱模拟。

---

## 6. 当前实现判断

当前工程已经有合同规则配置的基础资产：
- 配置中心合同规则 Tab
- `/api/configs?type=CONTRACT_RULE`
- `/api/contract-policies/rules`
- `/admin/rule-simulator`
- `/admin/rule-review`
- `contract_rules_v2` 及规则版本迁移
- 预置合同规则迁移

当前必须修正的方向不是再新增一套规则系统，而是：
1. 复用已有配置中心和规则表资产
2. 保证预置规则真实进入生产数据库
3. 保证合同审核、模拟审核、谈判任务和批注输出读取同一套已发布规则事实
4. 保证配置中心、规则模拟、审核报告的 API 响应格式一致
5. 补齐规则到 `SkillBundle` 的编译输入：模板引用、输出模板、处理角色、谈判要求、评测用例
6. 把规则列表 UI 从散点规则卡片升级为规则集树、规则列表、结构化详情和转译 diff 的三栏闭环

2026-07-02 已落地的第一阶段状态：
- 配置中心规则页已按 `clause_category` 聚合为规则集目录，并在规则卡片和右侧摘要展示发布、转译、阻断和“是否进入正式审核”。
- `RuleSet` / `RuleSetDocument` 已成为配置中心规则资产：规则集有独立目录、版本、发布状态；规则集文档可保存 Markdown/自然语言声明，并在 F006 编译时冻结到 `RuleSetSnapshot` / `document_snapshot_ids`。
- `loadFlexibleRules` 默认只加载正式发布且已转译规则；配置中心测试场景可显式加载未发布规则，但不能成为正式审核默认行为。
- `/api/rules/stats` 不再把 `is_active=true` 统计为 `published`，而是拆分 `active_rules`、`published_rules`、`draft_rules`、`translation_pending_rules`。
- 合同审核详情在没有绑定风险规则时，回退证据查询也只读取正式发布且已转译规则。
- R001 `付款节奏` 是复合规则：既检查首付款比例，也检查账期/验收后付款天数；`账期>30工作日` 必须按配置中心发布规则进入确定性红线，不得只依赖模型自由判断。

---

## 7. 涉及文件

- `product-truth/product-code/app/configs/ConfigsClient.tsx`
- `product-truth/product-code/app/configs/tabs/RuleTab.tsx`
- `product-truth/product-code/app/admin/rule-review/page.tsx`
- `product-truth/product-code/app/admin/rule-simulator/page.tsx`
- `product-truth/product-code/app/api/configs/route.ts`
- `product-truth/product-code/app/api/contract-policies/rules/route.ts`
- `product-truth/product-code/app/api/rules/simulate/route.ts`
- `product-truth/product-code/lib/configs/types.ts`
- `product-truth/product-code/lib/configs/validation.ts`
- `product-truth/product-code/lib/rules/engine.ts`
- `product-truth/product-code/lib/rules/flexible-engine.ts`
- `product-truth/product-code/lib/contract-analysis.ts`
- `product-truth/product-code/supabase/migrations/20260619000004_seed_contract_rules.sql`
- `product-truth/product-code/supabase/migrations/20260625162638_contract_rule_engine_alignment.sql`

---

## 8. 验收标准

- [x] 配置中心能看到合同审核规则入口，且不与组织权限混在同一控制面
- [x] 规则以规则集为一级资产展示，左侧有知识库式目录；`RuleSetDocument` 可作为规则集声明资产保存并进入 SkillBundle 快照
- [x] 单条规则的结构化字段、约束条件、证据要求、谈判动作、批注模板和测试结果可见可维护
- [ ] Markdown/自然语言规则声明可作为高效维护来源，但 AI 转译结果必须显示字段级 diff 并经人工确认
- [x] 生产数据库存在稳定预置规则，至少覆盖 `R001` 至 `R015`
- [ ] 规则列表、规则审核、规则模拟读取同一套规则数据
- [ ] 新建/编辑/启用/禁用规则后，有版本和审计记录
- [x] 合同审核执行时只读取正式发布且已转译规则
- [x] 合同审核报告显示的风险等级、标题、建议来自规则配置或规则快照
- [x] F006 能用已发布规则快照编译 `SkillBundle`
- [ ] 每条规则能声明默认处理角色和是否必须销售谈判
- [ ] 每条规则能关联标准模板、条款库或法规依据
- [ ] 发布前至少能跑单规则测试和一组合成合同回归样例
- [ ] 风险任务生成基于审核风险结果，不重复生成同一合同的处理任务
