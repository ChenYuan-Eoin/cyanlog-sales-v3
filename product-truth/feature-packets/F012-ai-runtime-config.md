# Feature Packet: F012-AI运行时配置

**Created**: 2026-06-09  
**REQ ID**: F012  
**Status**: confirmed  
**Parent**: 配置中心  
**Depends On**: `F000-config-center-architecture`

---

> 当前 9 个执行目标的唯一账本：`product-truth/feature-packets/F099-current-goal-ledger.md`。本文件承接其中 `G1 平台 AI 能力底座`。

## 1. 单元定义

**目标**：把 AI 调用从散落环境变量升级为平台级 AI 能力底座。配置中心负责管理模型 Provider、模型映射、模型应用、工具消费策略、路由、超时、降级和调用证据；业务页面只消费已发布策略，不直接感知底层模型实例。

**这包拥有的内容**：
- 模型 Provider 配置：供应商、官网链接、API Base URL、API Key/认证字段、API 格式、模型列表与映射、JSON 扩展配置
- 模型应用配置：应用名称、启用计划、默认 System Prompt、可消费的 Agent/工具范围
- 工具消费策略：合同审核、合同对比、合同起草、标书/长文档解析等功能如何选择策略
- 路由策略：任务类型、文本长度、文件类型、敏感级别、质量优先/成本优先/本地优先等条件匹配
- 降级链：超时、健康检查失败、低置信度、模型不可用时的下一跳
- 调用证据：每次 ReviewRun / DraftRun / CompareRun 的 provider、model、phase、token、cost、status、degraded、error

**这包不拥有的内容**：
- 合同审核规则本体（属于 `F009`）
- 合同审核执行（属于 `F005 / F006`）
- Prompt 工程细节的业务含义

---

## 2. 三层落位

| 层级 | 本功能对应物 |
|------|--------------|
| 第一层：能力域 | 平台 AI 能力底座 |
| 第二层：具体配置 | Model Provider、Model Mapping、AI Application、Routing Policy、Fallback Chain、Invocation Evidence |
| 第三层：消费页面 | 合同审核、合同对比、合同起草、标书/长文档解析、后续 AI 辅助能力 |

---

## 3. 配置对象

### 3.1 模型 Provider

模型 Provider 是一个可独立调用的 AI 能力单元，不限定数量，也不写死为 L1/L2/L3。

必备字段：
- `provider_id`
- `display_name`
- `provider_type`：`lm_studio` / `openai_compatible` / `openai` / `anthropic` / `rule_engine` / `custom`
- `base_url`
- `auth_key_ref`
- `api_format`
- `model_mappings[]`
- `capabilities[]`：短文本、长文本、PDF、图片、结构化输出、函数调用等
- `timeout_ms`
- `health_status`

### 3.2 模型应用

模型应用定义“哪些业务 Agent 可以消费哪些模型能力”。

示例：
- 合同审核 Agent：合同语义审核、规则转译、批注草案、报告摘要
- 合同对比 Agent：差异解释、风险变化判断、审计摘要
- 合同起草 Agent：需求理解、条款生成、Word 草稿生成
- 标书/长文档 Agent：长 PDF/长文本解析、章节提取、摘要生成

每个应用必须配置：
- 默认 System Prompt
- 可用模型策略
- 是否启用计划/调度
- 最大上下文、最大耗时、最大成本
- 输出 schema 或质量门禁

### 3.3 工具消费策略

业务工具不直接选择模型实例，只选择策略。

| 策略 | 适用场景 | 示例 |
|---|---|---|
| 本地优先 | 合同正文、规则声明、敏感数据 | 先用 LM Studio，本地不可用再走云端 |
| 质量优先 | 复杂规则转译、低置信度复核、长文档 | 优先云端强模型，再降级到本地或人工 |
| 成本优先 | 批量摘要、轻量分类 | 优先小模型或规则引擎 |
| 合规优先 | 客户合同、涉密数据 | 禁止出境或禁止云端模型 |

### 3.4 路由与降级

路由条件至少包括：
- 任务类型：合同审核、合同对比、合同起草、标书解析、规则转译
- 文本长度和页数
- 文件类型：DOCX / PDF / 图片扫描件
- 敏感级别
- 模型健康状态
- 成本预算和超时预算
- 置信度和是否需要人工复核

L1/L2/L3 只能作为策略模板名称，不是底层数据结构。真实底层结构必须是多 Provider + 多策略 + 可配置 fallback chain。

### 3.5 调用参数
- `temperature`
- `max_tokens`
- `json_mode`
- 重试次数 / 超时

---

## 4. 安全与密钥约束

- API Key 读取时必须脱敏
- 更新配置时必须支持“保留已有密钥”
- 密钥不直接回显到普通业务页面
- 审核执行页只读取可运行配置，不暴露写入口

---

## 5. 与消费侧的边界

| 消费方 | 读取什么 | 不允许做什么 |
|--------|----------|--------------|
| `F005` 合同审核流程 | 当前生效模型应用、路由策略、调用证据 | 在审核页临时选择规则集版本或直接改模型配置 |
| `F006` 规则执行内核 | 确定性校验策略、证据定位策略、降级解释 | 冒充 AI 审核完成 |
| `F009` 规则配置 | 规则转译模型应用、测试沙箱策略 | 直接消费未发布草稿规则 |
| 合同对比 | 对比解释策略、长文档解析策略 | 用对比结果替代审核结论 |
| 合同起草 | 起草模型应用、模板策略 | 生成不可编辑的最终 PDF 冒充合同草稿 |
| 后续智能功能 | 模型选择策略 | 私自新增环境变量旁路 |

---

## 6. 数据建模原则

优先拆成强类型对象：
- `ai_provider_profiles`
- `ai_routing_policies`
- `ai_runtime_versions`

如果短期复用统一配置接口，也必须保证：
- 配置结构校验
- 版本可追溯
- 发布后消费
- 密钥单独处理

---

## 7. 当前实现判断

当前工程已有本地模型和降级链代码，但仍主要偏运行时拼装，配置中心控制面并未真正建成。

因此本 REQ 当前为 `confirmed`：
- 真相已经明确
- 下一步开发应围绕“配置生产面 + 运行时消费链”展开

---

## 8. 涉及文件

- `product-truth/product-code/app/configs/page.tsx`
- `product-truth/product-code/app/api/configs/route.ts`
- `product-truth/product-code/app/api/configs/[id]/route.ts`
- `product-truth/product-code/lib/configs/runtime.ts`
- `product-truth/product-code/lib/ai/failover.ts`

---

## 9. 验收标准

- [ ] 可配置本地模型与销售云端模型
- [ ] 可测试连接与健康状态
- [ ] 路由阈值与超时参数可配置
- [ ] 消费侧只读取已发布 AI 配置
- [ ] 支持多个 Provider、多个模型映射和多个模型应用
- [ ] 支持为所有 Agent 配置 System Prompt
- [ ] 支持按工具消费策略选择模型，而不是前端直接选模型实例
- [ ] 真实调用写入 `model_invocations`，包含 token、cost、status、degraded、error
- [ ] 规则引擎兜底必须显示为降级结果，不能显示为 AI 审核完成
