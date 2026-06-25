# Feature Packet: F009-合同审核规则配置

**Created**: 2026-06-25  
**REQ ID**: F009  
**Status**: confirmed  
**Parent**: 配置中心  
**Depends On**: `F000-config-center-architecture`  
**Consumed By**: `F005` 合同中心, `F006` 合同规则执行内核

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

**这包不拥有的内容**：
- 合同上传、解析、审核结果展示（属于 `F005`）
- 规则执行内核、风险聚合算法（属于 `F006`）
- AI Provider、模型路由、降级策略（属于 `F012`）
- 组织架构、角色权限、数据范围（属于 `F011`）

---

## 2. 三层落位

| 层级 | 本功能对应物 |
|------|--------------|
| 第一层：能力域 | 合同审核规则配置 |
| 第二层：具体配置 | 结构化规则、语义规则、版本、生效状态、测试用例 |
| 第三层：消费页面 | 合同上传/审核页、审核报告页、ASK 生成链路 |

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

---

## 4. 数据建模原则

合同规则优先使用强类型表，不应只压进泛型 `configs`：
- `contract_rule_sets`
- `contract_rules_v2`
- `contract_rule_versions`
- `contract_rule_test_cases`
- `contract_rule_audit_logs`

MVP 可以继续兼容已有 `rules` / `configs` 数据，但必须满足：
- 规则有稳定编码和版本
- 已发布规则能被审核执行链读取
- 规则变更可追溯
- 预置规则可重复迁移而不重复插入

---

## 5. 消费映射

| 消费方 | 读取什么 | 写入什么 |
|--------|----------|----------|
| `F005` 合同审核页 | 已发布规则、风险模板 | 审核任务、风险卡片、ASK |
| `F006` 规则执行内核 | 结构化/语义规则定义 | 规则命中结果 |
| 审核报告页 | 风险等级、消息模板、建议 | 报告展示状态 |
| ASK 生成链路 | 红/黄风险卡片、处理角色 | ASK 清单 |

**硬边界**：合同中心可以触发审核和查看命中结果，但不能在合同页面修改规则配置。

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
3. 保证合同审核、模拟审核、ASK 链路读取同一套已发布规则事实
4. 保证配置中心、规则模拟、审核报告的 API 响应格式一致

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
- `product-truth/product-code/supabase/migrations/20260619000004_seed_contract_rules.sql`

---

## 8. 验收标准

- [ ] 配置中心能看到合同审核规则入口，且不与组织权限混在同一控制面
- [ ] 生产数据库存在稳定预置规则，至少覆盖 `R001` 至 `R015`
- [ ] 规则列表、规则审核、规则模拟读取同一套规则数据
- [ ] 新建/编辑/启用/禁用规则后，有版本和审计记录
- [ ] 合同审核执行时只读取已发布规则
- [ ] 合同审核报告显示的风险等级、标题、建议来自规则配置或规则快照
- [ ] ASK 生成基于审核风险结果，不重复生成同一合同的 ASK 清单
