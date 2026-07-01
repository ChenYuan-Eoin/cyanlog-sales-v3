# Feature Packet: F012-AI运行时配置

**Created**: 2026-06-09  
**REQ ID**: F012  
**Status**: confirmed  
**Parent**: 配置中心  
**Depends On**: `F000-config-center-architecture`

---

## 1. 单元定义

**目标**：把 AI 调用从散落环境变量升级为配置中心拥有的运行时策略，统一管理本地模型、销售团队云端模型和规则降级链。

**这包拥有的内容**：
- 本地模型连接
- 销售团队云端模型连接（OpenAI 兼容）
- 路由阈值
- 调用参数
- 降级优先级
- 模型调用审计记录
- 输出 schema 校验策略

**这包不拥有的内容**：
- 合同审核规则本体（属于 `F009`）
- Skill 编译与合同审核执行（属于 `F006`）
- 合同工作台、风险处理、销售谈判（属于 `F005`）
- Prompt 工程里的业务规则含义（属于 `F009 / F006`）

---

## 2. 三层落位

| 层级 | 本功能对应物 |
|------|--------------|
| 第一层：能力域 | AI 运行时配置 |
| 第二层：具体配置 | Provider Profile、Routing Policy、Timeout、Fallback |
| 第三层：消费页面 | 合同审核、谈判任务、批注输出、后续 AI 辅助能力 |

---

## 3. 配置对象

### 3.1 本地模型
- 支持用户自有推理服务
- 只要求 OpenAI 兼容接口
- 可配置 `base_url / model / timeout`

### 3.2 销售团队云端模型
- 优先支持销售团队自有 OpenAI 兼容网关
- 不绑定某个固定厂商
- 作为本地模型失败后的云端补位

### 3.3 路由策略
- 按页数、耗时、任务类型切换
- 支持本地优先 / 云端补位 / 规则兜底

### 3.4 调用参数
- `temperature`
- `max_tokens`
- `json_mode`
- 重试次数 / 超时

### 3.5 输出约束
- 是否强制 JSON/schema 输出
- 输出校验失败后的降级动作
- 是否允许重试
- 是否允许进入人工复核

### 3.6 调用审计
- `model_invocation_id`
- provider / model / policy version
- 任务类型：分类、语义规则、模板对比、话术生成
- 输入摘要 hash，不保存不必要敏感全文
- 输出校验结果
- 超时、重试、降级原因

### 3.7 历史模型资产摘录

从旧主文档附录和 `F005-derive.md` 摘录到 F012 的内容如下：

| 历史资产 | F012 处理方式 |
|----------|---------------|
| 本地模型优先 | 作为一种 `Routing Policy`，不是写死路径 |
| 云端模型补位 | 作为本地失败、超时或低置信度后的可配置 fallback |
| 规则引擎兜底 | 模型失败时可退回结构化规则和人工复核，不伪造 AI 成功 |
| 人工补判 | 作为降级动作写入审计，不属于模型 Provider |
| 降级状态显化 | 消费侧可展示用到的层级、耗时、失败原因和人工复核要求 |
| Codex 边界 | Codex 只用于研发辅助、规则代码和文档，不参与生产合同审核 |

模型链路必须遵循：
1. F012 只决定“调用哪个模型、何时超时、如何降级、如何记录”。
2. F009/F006 决定“审核什么、按什么规则审核、输出什么结构”。
3. 任何模型输出必须通过 F006 schema 校验后才能进入 `RiskFinding`。
4. 生产审核不得依赖开发期 agent 自由判断。

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
| `F005` 合同审核流程 | ReviewRun 绑定的模型策略摘要 | 直接改模型配置 |
| `F006` Skill 运行时 | Provider Profile、Routing Policy、Timeout、Fallback、schema 策略 | 执行中写回 AI 配置 |
| 后续智能功能 | 模型选择策略 | 私自新增环境变量旁路 |

模型调用必须服从 F006 的 `SkillBundle`。F012 只回答“调用哪个模型、如何超时、如何降级、如何记录”，不回答“合同风险规则是什么”。

---

## 6. 数据建模原则

优先拆成强类型对象：
- `ai_provider_profiles`
- `ai_routing_policies`
- `ai_runtime_versions`
- `model_invocations`

如果短期复用统一配置接口，也必须保证：
- 配置结构校验
- 版本可追溯
- 发布后消费
- 密钥单独处理

---

## 7. 当前实现判断

当前工程已有本地模型和降级链代码。2026-07-01 第一阶段已补齐合同审核链路需要的真实运行对象，但配置中心的模型策略编辑、连接测试和健康状态还不是完整商业产品形态。

第一阶段已落地：

- `model_policies`：从已发布 `AI_CONFIG` 配置解析为运行策略，包含 providers、routing、fallback、timeouts、schema_policy、status、version 和发布审计字段。
- `model_invocations`：每次合同审核运行记录 provider、model、policy_id、skill_bundle_id、review_id、fallback_reason、duration/status 和输入/输出摘要。
- `contract_reviews.model_policy_id` / `model_invocation_ids`：ReviewRun 绑定当次使用的模型策略和调用审计。
- 规则兜底作为内置 provider 明确进入策略链，而不是在业务代码里静默当作“AI 成功”。

仍未关闭的后续项：

- 配置中心尚未提供完整的 Provider Profile / Routing Policy 编辑器、连接测试和健康状态面板。
- 密钥仍应继续通过安全引用处理，不能把明文 key 暴露给合同审核页。
- F012 只负责模型路由、超时、降级和审计；审核规则含义仍由 F009/F006 拥有。

---

## 8. 涉及文件

- `product-truth/product-code/app/configs/page.tsx`
- `product-truth/product-code/app/api/configs/route.ts`
- `product-truth/product-code/app/api/configs/[id]/route.ts`
- `product-truth/product-code/lib/contracts/model-policy.ts`
- `product-truth/product-code/lib/contracts/skill-bundle.ts`
- `product-truth/product-code/supabase/migrations/20260701033715_f006_f012_runtime_objects.sql`
- `product-truth/product-code/lib/configs/runtime.ts`
- `product-truth/product-code/lib/ai/failover.ts`
- `product-truth/product-code/lib/ai/router.ts`
- `product-truth/product-code/lib/validation/ai-output.ts`

---

## 9. 验收标准

- [x] 可从已发布 AI 配置生成本地模型、云端模型和规则兜底的运行策略对象
- [ ] 可测试连接与健康状态
- [x] 路由阈值与超时参数可进入 `ModelPolicy`
- [x] 消费侧只读取已发布 AI 配置，缺失时显式降级到内置规则兜底策略
- [x] F006 调用模型时必须带 `skill_bundle_id` 和 `model_policy_id`
- [x] 每次模型调用生成 `model_invocation_id`
- [ ] 输出 schema 校验失败时进入重试、降级或人工复核，不伪装成功
- [x] 历史 ReviewRun 可查看当时使用的模型策略、provider、降级原因
