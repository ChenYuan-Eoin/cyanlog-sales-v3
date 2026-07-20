# Feature Packet: F012-AI 平台配置与运行边界

**Created**: 2026-06-09  
**Rebased**: 2026-07-20
**REQ ID**: F012  
**Status**: implementation-candidate / WP01 / pending-final-revalidation
**Parent**: 配置中心  
**Depends On**: `F000-config-center-architecture`

---

## 1. 产品目标

F012 把 AI 建成可以被任意业务模块消费的全局平台能力，不从属于合同审核。

产品链路只有一条：

`业务用点 → 应用绑定 → AI 应用 → 路由策略 → 模型目录 → Provider 连接`

管理员不需要理解环境变量、模型 SDK、合同运行阶段或机器内部策略。管理员要完成的是：

1. 接入一个模型服务；
2. 登记该服务下可用的一个或多个模型；
3. 定义可复用的 AI 应用能力；
4. 为应用配置有序候选模型与失败动作；
5. 把产品代码已注册的业务用点绑定到已发布应用；
6. 通过依赖检查后独立发布每类资产。

## 2. F012 拥有与不拥有的内容

### 2.1 拥有

- Provider 端点、协议、认证和运行位置；
- 同一 Provider 下的多个模型目录条目；
- 模型的通用能力声明；
- AI 应用的能力合同；
- 产品代码注册的业务用点；
- 业务用点到 AI 应用的绑定；
- AI 应用的有序候选模型、超时和失败动作；
- 配置草稿、发布、版本、兼容读取和一次性草稿参数 probe。

### 2.2 不拥有

- 合同规则集、问题分类、具体规则、规则属性、判定与处理，属于 `F009 / WP03`；
- Prompt 中的业务规则含义和 Skill 编译，属于 `F006`；
- 合同审核工作台、循环复审和文件交付，属于 `F005`；
- 真实 Provider 调用、token、`model_invocations`、ReviewRun 和准确率验收，属于 `WP02`；
- `rule-engine`。规则引擎是确定性业务执行能力或失败后的处理路径，不是 Provider 或模型。

## 3. 六个独立平台对象

| 对象 | 稳定身份 | 负责 | 禁止混入 |
|---|---|---|---|
| `ProviderConnection` | `asset_id` | `provider_type`、`runtime_location`、`base_url`、认证模式、密钥输入与连接超时 | 具体模型、业务模块、合同阶段、规则 |
| `ModelCatalogEntry` | `asset_id` | `provider_connection_id`、远端 `model_id`、通用能力、上下文窗口 | Provider 密钥、业务规则 |
| `AIApplication` | `asset_id` | 可复用的逻辑能力合同 | Provider、具体模型、合同规则 |
| `BusinessUsePoint` | `asset_id` | 业务代码中的稳定消费入口及所需能力 | 模型选择、密钥、自由文本机器字段 |
| `ApplicationBinding` | `asset_id` | `business_use_point_id → ai_application_id` | Provider 或具体模型 |
| `RoutePolicy` | `asset_id` | `ai_application_id → 有序模型候选`、单次超时、全部失败动作 | 合同规则集和问题分类 |

全部新对象使用 `schema_version=ai-platform.v1` 和严格 discriminated schema。`kind` 与 `asset_id` 是稳定身份，编辑已有对象时不可改变。

### 3.1 能力匹配

- 模型目录声明自身支持的能力；
- AI 应用声明它向业务提供的能力；
- 业务用点声明产品代码所需能力；
- 发布路由时，每个候选模型必须覆盖应用能力；
- 发布绑定时，应用必须覆盖业务用点能力，且应用必须已有已发布路由。

引用对象必须处于 `PUBLISHED + enabled`，草稿和停用对象不能被当作可用依赖。

### 3.2 业务用点注册表

`BusinessUsePoint` 不是管理员随意创造的机器字段。当前产品代码注册：

| 用点 ID | 模块 | 需要能力 |
|---|---|---|
| `contract.review.semantic` | 合同审核 | 文本生成、结构化输出 |
| `contract.review.chat` | 合同审核 | 文本生成 |
| `contract.draft.generate` | 合同起草 | 文本生成、结构化输出 |
| `tender.document.extract` | 标书文档 | 文本生成、长上下文、结构化输出 |
| `generic.ai.analyze` | 共享兼容入口 | 文本生成 |

新增 AI 功能时，开发先在代码注册稳定用点，管理员随后选择应用绑定。这样不管产品增加多少功能，都可以接入 AI，但不会出现“后台配了一个名称，业务代码根本不会消费”的假能力。

## 4. 管理员五个主任务

| 顺序 | 任务 | 用户回答的问题 | 完成结果 |
|---|---|---|---|
| 1 | 模型接入 | 账号和端点能否访问？ | Provider 连接草稿、当次 probe 结果 |
| 2 | 模型目录 | 该连接下哪些模型可用？ | 一个或多个模型条目及能力 |
| 3 | AI 应用 | 提供什么能力，主备模型如何降级？ | AI 应用 + RoutePolicy |
| 4 | 业务绑定 | 哪个产品入口消费哪个应用？ | BusinessUsePoint + ApplicationBinding |
| 5 | 发布状态 | 引用是否完整，当前版本是否可发布？ | 依赖结论、版本、发布或新草稿动作 |

五项是可反复进入、可通过 `?tab=ai&view=...` 深链的管理员任务，不是把所有卡片同时铺开的长页面。桌面和 iPad 都保持任务顺序；禁止 CSS masonry、`columns` 或异高 Grid stretch 再次制造白色空洞和阅读顺序漂移。

## 5. 草稿、发布、修订与兼容

### 5.1 生命周期

- 新对象先保存为 `DRAFT`，不进入引用真相；
- 发布前执行 schema、注册表、引用和能力匹配检查；
- `BusinessUsePoint` 即使停用也必须来自代码注册表；停用只影响消费引用，不能绕过身份校验；
- 已发布、已归档对象不可原地编辑、删除或回滚；
- 修订使用新的物理记录键，保留同一个逻辑 `asset_id`；
- 新修订发布时归档同 kind + asset_id 的旧发布版本；
- 草稿可按配置历史回滚，但历史版本不能跨 kind 或 asset_id；
- Provider 历史版本永远不得作为密钥来源；修订要沿用凭据时，只能由服务端从同组织、同逻辑资产的当前安全记录读取，并且 Provider 类型、运行位置和规范化端点均未改变。

### 5.2 当前兼容存储

WP01 不做不可逆数据库迁移，不写 Production。六类对象当前以“一行一个强类型对象”的方式暂存于既有 `configs` 表：

- 代码类型、Zod schema、引用校验和 UI 都是独立对象；
- Provider 密钥作为当前记录的顶层受控输入，API 只允许返回“已配置”状态，不回传真实值；
- 隔离 Preview `vsfropnfsmnonkotywsx` 已应用 `20260715124528_secure_ai_config_control_plane.sql`；迁移前历史泄漏计数为 0，动态 bearer canary 验证 `version_row_created=true`、`history_secret_absent=true`、`live_secret_present_before_cleanup=true`、`fixture_clean=true`；
- 该 Preview 中 `configs / config_versions` 对 `anon / authenticated` 无表权限，`service_role` 仅保留服务端必需权限；
- 上述结论只证明隔离 Preview 数据层的密钥历史边界；不证明最终应用候选或 Production 已通过，Production 仍保持只读；
- 禁止把六类对象聚合成一个嵌套 JSON 图；
- 旧 `kind=provider/application/tool_policy` 只读保留；
- 新图未切运行时，旧 `AI_CONFIG / ModelPolicy` 继续作为 WP02 前的兼容运行事实；
- 严禁把一部分新图和一部分旧配置拼成混合运行链。

这是可回滚的过渡方案，不推翻 F000 的长期原则。若以后迁入独立强类型表，必须先在隔离 Preview 完成新增式迁移、RLS、租户隔离、事务发布和回滚验证，再单独进入发布工作包；不得在 WP01 暗改 Production。

### 5.3 当前发布限制

既有通用 `configs` 存储没有专用事务发布 RPC。当前 API 在切换新逻辑版本失败时会恢复前一发布版本，但这仍不是数据库级原子事务。WP01 可以完成控制面候选；Production 切换前，WP09 必须决定并验收专用事务/RPC 或强类型表发布方案。

## 6. Provider 连接测试与密钥边界

`POST /api/configs/ai-runtime/probe` 在 WP01 有两种明确口径：

- `probe_mode=connection`：检查 Provider 和 `/models`，发现可用模型；不执行生成；
- `probe_mode=model`：在选定模型后执行最小生成测试。

两者都只是当前草稿、当次请求的技术探测：

- 不保存探测输入；
- 不持久化 Provider 连接状态或生产健康状态，页面上的结果只对当次草稿操作有效；
- 不作为发布成功的充分条件，也不得显示为“生产可用”；
- 不写 `model_invocations`；
- 不证明业务模块已使用该模型；
- 不证明 ReviewRun、token 或审核准确率；
- 配置层允许最多 `300000ms`，执行层把健康检查、模型列表和最小生成统一夹紧为本地 `15-120s`、云端 `8-60s`；
- 浏览器不回填已存 Token，也不把 `***` 掩码当真实密钥发送；
- 测试已有连接时，服务端按 `config_id + org_id + type` 读取凭据，且只有 Provider 类型、Base URL 和协议身份未改变时才复用；
- 管理员明确输入新 Token 时，探测只使用本次草稿参数，不读取旧 `config_id` 的密钥，因此可以先测试“新端点 + 新凭据”再保存；
- 地址或连接身份变化而未提供新密钥时，旧密钥必须清除，防止发往错误第三方；
- API 响应、历史版本和日志不得回显真实密钥。

发往 Provider 的请求统一经过出站安全会话：DNS 有截止时间、全部解析地址必须合规、连接固定到已校验地址、禁止重定向和跨来源请求，并限制响应大小。本地回环探测默认关闭，只允许开发机显式开启；例如本地 LM Studio 使用 `http://127.0.0.1:1234/v1` 时，启动应用前设置：

```bash
ALLOW_LOCAL_AI_ENDPOINTS=true
LOCAL_AI_ALLOWED_ORIGINS=http://127.0.0.1:1234
```

这两个变量只在 `NODE_ENV=development` 生效，且必须精确匹配来源；Preview、Production 或未列入白名单的回环端口一律拒绝。`localhost` 在实际传输前规范为 `127.0.0.1`，因此白名单使用后者。

## 7. WP01 与 WP02 的完成边界

### 7.1 WP01 控制面候选

WP01 负责：

- 六对象类型和严格 schema；
- 代码注册业务用点；
- 独立创建、编辑草稿、发布依赖检查、版本和草稿回滚；
- Provider 草稿参数探测和模型发现；
- 五任务 UI；
- 旧配置只读兼容；
- 桌面与 iPad 配置任务验收。

### 7.2 WP02 运行真实性

WP02 才负责：

- 让所有业务调用点从 `BusinessUsePoint` 解析到唯一发布应用；
- 将完整新图编译成运行路由，禁止环境变量静默旁路；
- Provider 真实 probe、最小生成和多个模型样本；
- `model_invocations`、token、ReviewRun、降级原因与运行配置一致；
- 证明合同审核、起草、标书等实际业务按绑定应用运行；
- 审核准确率和共同真实合同对比。

因此，WP01 页面只展示简短兼容摘要，不再用大段 ReviewRun / ModelPolicy 机器证据占据配置主任务。

## 8. 代码事实

| 范围 | 主要文件 |
|---|---|
| 类型和 schema | `lib/configs/types.ts`、`lib/configs/validation.ts` |
| 分类与发布图 | `lib/configs/ai-config-kind.ts`、`lib/configs/ai-platform.ts` |
| 业务用点注册 | `lib/configs/ai-platform-registry.ts` |
| CRUD / 发布 / 回滚 | `app/api/configs/route.ts`、`app/api/configs/[id]/*` |
| 连接与模型探测 | `app/api/configs/ai-runtime/probe/route.ts` |
| 管理员任务 UI | `app/configs/tabs/AIConfigTab.tsx`、`app/configs/dialogs/AIEditForm.tsx` |
| 旧运行时兼容 | `lib/configs/runtime.ts`、`lib/contracts/model-policy.ts` |

## 9. 验收与下游发布门禁

### 9.1 WP01 退出门禁

当前代码已形成 WP01 实现候选，但不用“已编码”代替“已完成”。WP01 只以下列控制面证据为退出门禁；不等待 WP02 的真实业务运行，也不等待 WP09 的 Production 发布：

- [ ] **六对象与 API**：类型、规范化持久化、完整发布图、唯一绑定/路由、反向依赖和单行 DRAFT CAS 冲突处理通过目标测试；
- [ ] **Provider 安全**：修订凭据复用、连接身份变更清密钥、访问权限与 SSRF 边界通过负向测试；
- [ ] **配置 UI**：五任务的创建、修订、有序候选、发布、历史和草稿错误在桌面与 iPad 实浏览器重验，并覆盖 0/1/14/50 条数据及弹窗开关；
- [x] **Preview 密钥安全**：隔离 Preview `vsfropnfsmnonkotywsx` 已应用安全迁移并通过动态密钥历史 canary；Production 未触碰；
- [ ] **Preview 控制面闭环**：以最终 Git SHA 在同一隔离 Preview 重验六对象创建、修订、发布、唯一解析、历史/回滚和脱敏读回；
- [ ] **兼容与回滚**：旧 `AI_CONFIG / ModelPolicy` 仍可只读消费，新图不与旧图混合，候选可回退到旧运行事实而不丢失历史引用；
- [ ] **工程与证据**：目标测试、全量测试、lint、typecheck、build、浏览器截图与脱敏读回结果被同一最终 Git SHA 的证据索引引用。

上述 WP01 退出门禁通过即可把 WP01 转为 completed，并让 WP02 进入 Active。

### 9.2 下游门禁（不阻塞 WP01 退出）

- **WP02 运行真实性**：真实业务调用从业务用点解析到已发布应用，并提供 invocation/token/ReviewRun、降级一致性和准确率证据；
- **WP09 发布验收**：Production 前完成数据库原子发布、RLS、环境和正式发布验收。

两项都是 WP01 完成后的下游工作，不得回填为 WP01 的完成前置条件。

## 10. 历史口径

2026-07-20 之前的 `L1 本地 / L2 云端 / L3 规则兜底`、合同阶段复选框和 `ModelPolicy provider_chain` 是旧运行兼容口径，不再是平台配置产品模型：

- L1/L2 旧 Provider 行可在 WP02 迁移时投影为 ProviderConnection + ModelCatalogEntry；
- `rule-engine` 不能投影为 Provider 或模型；
- 合同运行阶段属于业务用点、规则/Skill 和运行审计，不回填 Provider；
- 历史 `model_invocations` 继续作为当时运行证据，不改写、不删除；
- WP01 退出前必须证明旧配置仍可只读消费且候选可安全回退；WP02 提供完整新图运行证据后，才能单独决定旧运行链的退役。
