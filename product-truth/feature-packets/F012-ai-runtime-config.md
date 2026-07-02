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
- 可配置 `base_url / model / timeout / api_key`
- LM Studio 开启 `Require authentication` 时，配置中心或环境变量必须提供 Bearer Token；只加载本地模型不等于应用可调用本地模型。
- 本阶段推荐 L1 本地模型名为 `gpt-oss-20b`，base URL 为 `http://localhost:1234/v1`；模型名必须与 LM Studio 已加载 identifier 一致。

### 3.2 销售团队云端模型
- 优先支持销售团队自有 OpenAI 兼容网关
- 不绑定某个固定厂商
- 作为本地模型失败后的云端补位
- 对长文本、长 PDF、标书解析等任务，L2 云模型不是备用摆设，而是高能力增强层；配置中心必须支持 `base_url / api_key / model / timeout / routing.strategy=chunked / max_pages`。
- 2026-07-02 当前验收配置：`AI_LEVEL_2` 使用 OpenAI-compatible `https://cloud.yiyongai.cn/v1`，模型为 `gpt-5.5`，路由策略为 `chunked`，`max_pages=120`。该事实以配置中心发布值和 `model_invocations.transport=openai_compatible_http` 为准，不能写死到业务代码。

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
- 规则转译草稿必须输出可校验 JSON；失败时只记录失败证据，不允许发布规则

### 3.6 调用审计
- `model_invocation_id`
- provider / model / policy version
- 任务类型：分类、语义规则、模板对比、话术生成、标书/长文档解析
- 任务类型必须区分 `rule_translation`、`semantic_review`、`comment_patch_draft`、`rule_fallback`、`tender_long_document_parse`
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

### 3.8 模型配置用户旅程

F012 的配置体验不能要求用户理解后端环境变量、模型 SDK 或开发工具配置文件。配置中心必须把模型链路整理成可操作的三段旅程：

| 层级 | 用户看到的对象 | 用户动作 | 系统验证 | 失败时提示 |
|------|----------------|----------|----------|------------|
| L1 本地模型 | `本地 LM Studio / gpt-oss-20b` | 启动本机 LM Studio，填写或确认 `base_url / model / token` | `/models` 健康检查；若 HTTP 认证失败，检测本机 `lms` CLI 是否可调用 | 区分“模型未启动”“Token 未通过”“HTTP 不通但 CLI 可用” |
| L2 云模型 | `OpenAI-compatible 云端网关` | 从 Token 控制台复制 API Key，填写云端 `base_url / model`，或从连接测试发现的模型中点选 | HTTPS `/models` 连接测试；真实 ReviewRun 再验证调用证据 | 区分“密钥缺失”“地址缺失”“Token 未通过”“云端不可达”“真实调用未验证” |
| L3 规则兜底 | `rule-engine` | 无需配置密钥 | 内置可用 | 明确标注“兜底规则，不等于 AI 审核完成” |

配置页必须提供：

- 从运行态卡片直接进入对应 L1/L2 配置的入口。
- L1/L2/L3 快速套用模板；模板只填表，不自动发布，不替代人工确认。
- 保存前连接测试：调用 `POST /api/configs/ai-runtime/probe`，仅验证当前表单值，不保存 Token，不写入 `model_invocations`。
- 连接测试必须严格检查 OpenAI-compatible HTTP 能力；若 LM Studio HTTP 返回 401，不得用本机 CLI fallback 掩盖 Token 问题。
- 云端连接测试必须访问 HTTPS OpenAI-compatible `/models`，认证失败展示 `remote_auth_failed`，网络或服务失败展示 `remote_health_failed`，测试通过展示 `remote_health_ok` 并返回可点选的模型 ID。
- OpenAI-compatible 的固定解释：`base_url + model + api_key/token`。
- OpenAI-compatible Base URL 允许用户填写供应商根地址；系统运行时必须规范化到 API base，例如 `https://cloud.yiyongai.cn` 规范化为 `https://cloud.yiyongai.cn/v1`，避免测试和正式调用路径不一致。
- LM Studio 本地 Token 的解释：若本地服务启用了认证，必须把 Developer 页生成的 Token 保存到 L1；只看到模型已加载不代表 HTTP 可调用。
- 云端 Token 的解释：Token 来源是云端控制台，例如 `https://cloud.yiyongai.cn/console/token`，但系统只保存用户显式粘贴的密钥，不从浏览器页面猜测或抓取密钥。
- 云端长文本任务的解释：合同长文本、标书解析、长 PDF 文本审核必须优先使用 L2 的 `chunked` 路由策略；本地模型可以做快速初筛，但不能因为 L1 存在就阻断 L2 高能力模型。合同长文本仍记录为 `phase=semantic_review`，但必须在 `request_meta` 记录 `provider_selection_reason/text_length/estimated_page_count/long_contract_cloud_required`，在 `response_meta.input_stats` 记录总分块、已选分块、文本总字符、已选字符、chunk 覆盖率和字符覆盖率。标书和独立长文档解析记录为 `phase=tender_long_document_parse`。覆盖不完整时不能展示为完整 AI 审核成功。
- 运行证据的解释：只有真实消费任务写入对应阶段的 `model_invocation` 且状态为 `completed`，才可宣称模型参与了审核；合同审核看 `semantic_review`，标书/独立长文档看 `tender_long_document_parse`。其中 `transport=openai_compatible_http` 才能证明 HTTP 模型接入通过，`transport=lm_studio_cli` 只能证明本机模型可执行，不能证明 HTTP Token 或线上模型链已验收。长合同/长 PDF 若缺少可用 L2 云端 Provider 或输入覆盖不完整，必须记录 `long_contract_cloud_provider_unavailable` 或 `semantic_review_input_coverage_limited`，并进入降级状态。

CC Switch 可以作为配置体验参考：它把 Provider、Base URL、API Key、模型 ID 和一键切换做成统一 UI。但它管理的是 Codex / Claude / Gemini 等开发工具的配置；合同审核产品运行时不能依赖 CC Switch 当前选中了什么 Provider。生产事实来源仍然是配置中心发布的 `AI_CONFIG -> ModelPolicy -> model_invocations`。

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

当前工程已有本地模型和降级链代码。2026-07-01 第一阶段已补齐合同审核链路需要的真实运行对象；2026-07-02 已补充配置中心运行状态解释、L1/L2/L3 旅程入口、LM Studio Token/CLI 状态区分、快速套用模板、保存前 HTTP 连接测试和 `/models` 模型列表自动发现。密钥引用体系和生产级 Provider Profile 编辑器仍不是完整商业产品形态。

第一阶段已落地：

- `model_policies`：从已发布 `AI_CONFIG` 配置解析为运行策略，包含 provider_chain、阶段路由、fallback、timeouts、schema 失败处理、status、version 和发布审计字段。
- `model_invocations`：每次模型消费任务记录 provider、model、policy_id、业务对象引用、phase、fallback_reason、duration/status 和输入/输出摘要；合同审核必须绑定 review/skill_bundle。合同长文本和长 PDF 的 `semantic_review` 必须额外记录 provider 选择原因、页数估计、云端增强要求、chunk 覆盖和字符覆盖；标书长文档解析必须记录 `phase=tender_long_document_parse`、chunk 覆盖、字符覆盖、耗时、并发和降级原因。
- `contract_reviews.model_policy_id` / `model_invocation_ids`：ReviewRun 绑定当次使用的模型策略和调用审计。
- 模型提示由 F006 `SkillBundle` 生成，必须携带配置中心发布规则源、已发布规则快照、输出 schema、二次校验要求和参考资产说明；GitHub/外部 skill 只能作为参考资产，不得作为生产规则来源。模型输出缺少规则编号、原文证据或 schema 不合格时不得持久化为有效风险。
- `rule_translation` 调用只生成 F009 规则草稿字段，不能直接发布规则；调用证据写入 `model_invocations`，且必须记录 `response_meta.transport` 与 `attempt_errors`，发布仍由规则版本 API 和 F006 门禁决定。
- 规则兜底作为内置 provider 明确进入策略链，而不是在业务代码里静默当作“AI 成功”。
- 本地模型调用顺序以配置中心 HTTP 为先：有已发布 `base_url/model/token` 时先走 OpenAI-compatible HTTP；HTTP 认证或调用失败时才降级到 LM Studio CLI，并在 `model_invocations.response_meta.transport`、`attempt_errors` 与合同详情页调用链中暴露 `lm_studio_cli`、`local_http_failed` 等原因。CLI 结果只能作为本机模型证据，不得作为 HTTP 接入或线上模型链完成证据。

当前 `ModelPolicy` 对象最低要求：

```ts
interface ModelPolicy {
  key: 'CONTRACT_REVIEW_DEFAULT'
  version: number
  status: 'draft' | 'published' | 'archived'
  is_current: boolean
  provider_chain: Array<{
    profile: string
    provider_kind: 'openai_compatible' | 'builtin'
    provider: string
    model: string
    runtime_location: 'local' | 'cloud' | 'builtin'
    level: number
    timeout_ms: number
    stages: Array<'structured_rules' | 'template_compare' | 'semantic_review' | 'tender_long_document_parse' | 'comment_patch_draft' | 'report_summary' | 'rule_fallback'>
    role: 'primary' | 'fallback'
    capabilities: string[]
    data_boundary: 'contract_text_redacted' | 'contract_text_allowed' | 'rules_only'
    health_check_required: boolean
    source_config_id: string | null
  }>
  routing_policy: {
    policy_version: 'f012.model-policy.v1'
    stage_order: string[]
    stage_provider_strategy: Record<string, string>
  }
  fallback_policy: {
    policy_version: 'f012.fallback.v1'
    final_fallback: 'rule_engine'
    on_timeout: string
    on_provider_error: string
    on_schema_error: string
  }
  audit_policy: {
    policy_version: 'f012.audit.v1'
    record_invocation: true
    require_skill_bundle_id: true
    require_model_policy_id: true
    required_spans: string[]
  }
}
```

结构化规则阶段可以由 `rule-engine` 执行；规则转译、语义审核、批注意图和报告摘要阶段必须通过已发布 provider 策略选择模型。Provider 链按 `local -> cloud -> builtin` 排序，本地 LM Studio / OpenAI 兼容模型优先；缺失、未授权、健康检查失败或超时时才降级到云端、规则兜底或人工复核。

本地模型健康判断以 OpenAI-compatible `/models` 为准：

- 若 LM Studio 要求认证，健康检查必须携带 `Authorization: Bearer <token>`。
- 若缺少 Token 或返回 401，页面必须展示本地模型未可用，不能宣称 L1 AI 审核完成。
- 若运行在真实 Vercel Functions，`localhost` 指向部署容器，不是用户本机；线上 L1 本地模型需要公网可访问的模型网关或专门的本地代理架构。

云端模型健康判断以 HTTPS OpenAI-compatible `/models` 为准：

- 非 HTTPS 云端地址不得由服务端探测，避免把配置中心变成任意内网探测入口。
- 用户填写云端根域名时，运行时和连接测试都必须补齐 `/v1` 后访问 `/models`；禁止出现保存值、探测值和正式调用值三套口径。
- 若返回 401/403，必须提示 Token 或模型权限不可用，不能展示为“具备调用条件”。
- 若 `/models` 通过，配置中心展示可点选模型 ID；但这只证明网关和密钥可用，正式合同审核仍必须以 ReviewRun 的 `semantic_review` 调用证据为准，且正式 HTTP 验收要求 `transport=openai_compatible_http`。

仍未关闭的后续项：

- 配置中心尚未提供完整的 Provider Profile / Routing Policy 编辑器；当前只提供保存前 HTTP 探测、模型列表发现和明文输入式密钥保存，未完成密钥引用管理。
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
- [x] API 可返回 Provider 连接与健康状态，并区分本地、云端、内置规则引擎
- [x] 配置中心可解释 L1/L2/L3 当前状态、阻塞原因和对应配置入口
- [x] 配置中心可在保存前对当前表单 Provider 执行 HTTP 连接测试，且不保存密钥、不用 CLI fallback 掩盖 HTTP 认证失败
- [x] 连接测试通过后可返回 OpenAI-compatible `/models` 模型列表，前端可点选模型 ID 填入配置
- [ ] 配置中心仍需补完整 Token 安全引用和生产级故障操作指引
- [x] 路由阈值与超时参数可进入 `ModelPolicy`
- [x] 消费侧只读取已发布 AI 配置，缺失时显式降级到内置规则兜底策略
- [x] F006 调用模型时必须带 `skill_bundle_id` 和 `model_policy_id`
- [x] 每次模型调用生成 `model_invocation_id`
- [x] 输出 schema 校验失败时进入重试、降级或人工复核，不伪装成功
- [x] 历史 ReviewRun 可查看当时使用的模型策略、provider、降级原因
