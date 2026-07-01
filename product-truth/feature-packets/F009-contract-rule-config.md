# Feature Packet: F009-合同审核规则配置

**Created**: 2026-06-25  
**REQ ID**: F009  
**Status**: confirmed  
**Parent**: 配置中心  
**Depends On**: `F000-config-center-architecture`  
**Consumed By**: `F006` 合同审核 Skill 运行时, `F005` 合同中心

---

## 1. 单元定义

**目标**：在配置中心维护合同审核运行所需的规则集合，让合同审核页只消费已发布规则，不在业务执行页临时修改规则。

**这包拥有的内容**：
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

第一阶段预置规则种子按 R001-R015 管理，编码稳定、内容可配置。当前标准源为 `suoyidev/ones-internal-skills` 的 `ones-contract-assistant` 条款速查表（当前对齐 commit `f8b0c27f5c19a499c1563923ca372a2171aaca58`）；导入后配置中心发布的 `RuleSnapshot` 才是运行时事实源，审核链路不得在运行时直接读取外部 repo。配置中心必须按 `clause_category` 业务域展示规则，并同时显示 `target_field`、`field_hints`、版本和启用状态，避免 R001-R015 被平铺成不可维护的规则清单。

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

以上规则只是种子范围，不代表写死规则逻辑。最终审核依据必须来自配置中心发布的 `RuleSnapshot`。外部 skill 更新时，通过受控导入脚本转译为 `contract_rules_v2` 属性字段、`semantic_prompt` 和 `message_template`，并生成新的发布快照；未变化的规则不得重复制造版本。

---

## 4. 数据建模原则

合同规则优先使用强类型表，不应只压进泛型 `configs`：
- `contract_rule_sets`
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

- [ ] 配置中心能看到合同审核规则入口，且不与组织权限混在同一控制面
- [ ] 生产数据库存在稳定预置规则，至少覆盖 `R001` 至 `R015`
- [ ] 规则列表、规则审核、规则模拟读取同一套规则数据
- [ ] 新建/编辑/启用/禁用规则后，有版本和审计记录
- [ ] 合同审核执行时只读取已发布规则
- [ ] 合同审核报告显示的风险等级、标题、建议来自规则配置或规则快照
- [ ] F006 能用已发布规则快照编译 `SkillBundle`
- [ ] 每条规则能声明默认处理角色和是否必须销售谈判
- [ ] 每条规则能关联标准模板、条款库或法规依据
- [ ] 发布前至少能跑单规则测试和一组合成合同回归样例
- [ ] 风险任务生成基于审核风险结果，不重复生成同一合同的处理任务
