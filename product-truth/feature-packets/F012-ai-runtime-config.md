# Feature Packet: F012-AI 平台配置与运行边界

**Created**: 2026-06-09  
**Rebased**: 2026-07-22
**REQ ID**: F012  
**Status**: WP01-completed / WP02-completed / WP09-hosted-runtime-active
**Parent**: 配置中心  
**Depends On**: `F000-config-center-architecture`

---

## 1. 产品目标

F012 把 AI 建成可以被任意业务模块消费的全局平台能力，不从属于合同审核。

产品链路只有一条：

`业务用点 → 应用绑定 → AI 应用 → 路由策略 → 模型目录 → Provider 连接`

管理员不需要理解环境变量、模型 SDK、合同运行阶段或机器内部策略。底层持久化由六类独立对象组成，下面只描述存储引用关系和发布前置条件，**不是业务人员的页面操作顺序，也不是另一套“六步主任务”**：

1. `ProviderConnection`：模型服务连接；
2. `ModelCatalogEntry`：引用一个 Provider，登记该服务下的具体模型；
3. `AIApplication`：定义与模型无关的可复用 AI 能力；
4. `BusinessUsePoint`：来自产品代码注册表的稳定功能入口；
5. `ApplicationBinding`：把业务用点引用到已发布 AI 应用；
6. `RoutePolicy`：把 AI 应用引用到有序模型候选和全部失败动作。

每类对象通过依赖检查后独立发布。业务人员实际看到并完成的操作顺序只有第 4 节“管理员五个主任务”；底层对象可以按依赖补齐和独立修订，但不得改变五个主任务的产品顺序。

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
- 真实 Provider 调用、token、`model_invocations` 与 ReviewRun 的审计合同由已完成的 `WP02` 固化；Hosted 环境投影和本次发布候选复验属于 `WP09`，业务输出质量与审核准确率继续由对应业务模块独立验收；
- `rule-engine`。规则引擎只执行已发布业务规则定义的确定性判定并保留自身证据；它不是 Provider、模型、`RoutePolicy` 候选，也不是模型失败后的兜底层。模型候选全部失败时只执行路由明确配置的转人工或停止动作。

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

### 3.3 管理员配置路由与运行环境投影

`RoutePolicy` 保存管理员批准的完整候选顺序；运行时再根据执行环境生成实际可执行顺序，两者不能互相覆盖：

- 本机运行可以消费本机 `ProviderConnection`，例如 `LM Studio → 云模型`；
- Vercel 等 Hosted 运行时不能访问用户电脑的 `127.0.0.1`，因此排除 `runtime_location=local` 的候选，并从第一个 cloud 候选开始真实调用；
- 环境排除不是连接失败，不生成被排除候选的 `model_invocations`，不增加 `attempt_no`，也不把首个 cloud 成功标成降级；
- Hosted 路由如果全部是 local 候选，则以 `RUNTIME_LOCATION_INCOMPATIBLE` 失败关闭，不能静默改走旧 ModelPolicy、环境变量或规则引擎；
- 运行快照保留 `orderedModelAssetIds`（管理员配置顺序）和 `effectiveOrderedModelAssetIds`（当前环境实际顺序）；后者必须是前者的有序子序列；
- 历史 `ai-runtime-plan.v1` 快照没有 effective 字段时，按当时 configured 即 effective 的原始语义读取，不改写历史 hash。

配置页面必须把这两种顺序翻译成业务事实，例如“本机可执行：Gemma → GPT-5.5；托管环境排除：Gemma（仅本机）；托管实际执行：GPT-5.5”。内部 asset ID、表名和环境变量仅作为展开后的审计信息，不能替代业务人员的主任务。

## 4. 管理员五个主任务

| 顺序 | 任务 | 用户回答的问题 | 完成结果 |
|---|---|---|---|
| 1 | 模型能力 | 哪些模型服务接得上，提供哪些可用模型能力？ | Provider 连接、模型目录与当次 probe 结果 |
| 2 | 业务使用 | 哪些产品功能使用哪个可复用 AI 能力？ | AIApplication、BusinessUsePoint 与 ApplicationBinding |
| 3 | 降级顺序 | 主模型、备用模型和全部失败动作是什么？ | RoutePolicy 的管理员配置顺序 |
| 4 | 实际执行 | 本机与托管环境真正会执行哪条路线，最近业务调用是否有 token 证据？ | effective route、invocation 与 ReviewRun 状态 |
| 5 | 发布与版本 | 引用是否完整，当前版本是否可发布？ | 依赖结论、版本、发布或新草稿动作 |

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
- 新六对象图已经由 WP02 切入正式业务运行；旧 `AI_CONFIG / ModelPolicy` 仅保留历史只读事实，不再作为新 ReviewRun 的模型选择来源；
- 严禁把一部分新图和一部分旧配置拼成混合运行链或静默走环境变量旁路。

这是可回滚的过渡方案，不推翻 F000 的长期原则。若以后迁入独立强类型表，必须先在隔离 Preview 完成新增式迁移、RLS、租户隔离、事务发布和回滚验证，再单独进入发布工作包；不得在 WP01 暗改 Production。

### 5.3 当前发布限制

既有通用 `configs` 存储没有专用事务发布 RPC。当前 API 在切换新逻辑版本失败时会恢复前一发布版本，但这仍不是数据库级原子事务。WP01 已在不宣称数据库原子性的边界内完成控制面；Production 切换前，WP09 必须决定并验收专用事务/RPC 或强类型表发布方案。

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

### 7.1 WP01 控制面（已完成）

WP01 负责：

- 六对象类型和严格 schema；
- 代码注册业务用点；
- 独立创建、编辑草稿、发布依赖检查、版本和草稿回滚；
- Provider 草稿参数探测和模型发现；
- WP01 旧版控制面五任务 UI（六对象创建、修订、候选排序、发布与历史；不等于第 4 节现行业务五任务）；
- 旧配置只读兼容；
- 桌面与 iPad 配置任务验收。

### 7.2 WP02 运行真实性（已完成）

WP02 已完成：

- 让所有业务调用点从 `BusinessUsePoint` 解析到唯一发布应用；
- 将完整新图编译成运行路由，禁止环境变量静默旁路；
- Provider 真实 probe、最小生成和多个模型样本；
- `model_invocations`、token、ReviewRun、降级原因与运行配置一致；
- 证明合同审核、起草、标书等实际业务按绑定应用运行；
- 共同真实合同的双模型固定探测、当前 route ReviewRun 和准确率声明边界。

实现提交 `c25ec17a8e51ec6476432ccccf9c30ee0dd9553b` 已将五个业务用点全部切入新图运行，并通过隔离 Preview、真实 LM Studio、云端降级、token、ReviewRun、桌面和 iPad 验收。准确率仍为 `blocked_without_independent_gold`：这不是运行失败，而是明确禁止在规则快照无效、没有事前独立金标时把模型响应冒充审核质量通过。完整证据位于 `output/evidence/wp02/README.md`。

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
| 运行计划与执行 | `lib/ai/runtime-plan.ts`、`lib/ai/runtime-executor.ts`、`lib/ai/contract-semantic.ts`、`lib/ai/tender-extract.ts` |
| 业务调用入口 | `app/api/contracts/[id]/review-runs/route.ts`、`app/api/contracts/[id]/ai-chat/route.ts`、`app/api/contracts/draft/route.ts`、`app/api/tenders/ocr/route.ts` |
| 运行真相 UI | `app/api/configs/ai-runtime/route.ts`、`app/configs/tabs/AIConfigTab.tsx` |
| 历史只读兼容 | `lib/configs/runtime.ts`、`lib/contracts/model-policy.ts` |

## 9. 验收与下游发布门禁

### 9.1 WP01 退出门禁

WP01 已由实现提交 `5a22f769ac03baf80d7436eecf79fe57a24c509b` 和回滚交互收口提交 `4269840fbc798eb9a92faee44d6e467a250033b4` 完成。证据索引位于 `output/evidence/wp01/README.md`，且以下旧版控制面门禁全部通过；WP02 的真实业务运行与 WP09 的新版业务五任务、Hosted 投影和发布候选验收没有被混入完成声明：

- [x] **六对象与 API**：类型、规范化持久化、完整发布图、唯一绑定/路由、反向依赖和单行 DRAFT CAS 冲突处理通过目标测试；
- [x] **Provider 安全**：修订凭据复用、连接身份变更清密钥、访问权限与 SSRF 边界通过负向测试；
- [x] **WP01 旧版控制面五任务**：六对象的创建、修订、有序候选、发布、历史和草稿错误在桌面与 iPad 实浏览器重验，并覆盖 0/1/14/50 条数据及弹窗开关；该证据不等于第 4 节现行“模型能力、业务使用、降级顺序、实际执行、发布与版本”已完成 WP09 验收；
- [x] **Preview 密钥安全**：隔离 Preview `vsfropnfsmnonkotywsx` 已应用安全迁移并通过动态密钥历史 canary；Production 未触碰；
- [x] **Preview 控制面闭环**：在同一隔离 Preview 重验六对象创建、修订、发布、唯一解析、历史/回滚和脱敏读回；63 条临时记录清理后残留为 0；
- [x] **兼容与回滚**：旧 `AI_CONFIG / ModelPolicy` 仅保留历史只读和回滚追溯，不再被正式业务运行消费；新图不与旧图混合，候选回滚不丢失历史引用；
- [x] **工程与证据**：182 个测试文件 / 1255 项测试、lint、typecheck、75/75 build、桌面/iPad、截图与脱敏读回由同一候选证据索引引用；独立 API/安全与 UI 复审均为 GO。

上述 WP01 退出门禁已通过，WP01 已转为 completed；WP02 随后也已完成，当前唯一 Active 为 WP09 的 Hosted 环境投影与发布候选验收。Harness selftest 与文档治理通过；doctor 为 0 failures / 2 条既有 Codex 项目信任警告，因此只声明本地门禁结果，不声明项目级 hooks 已加载生效。

### 9.2 WP02 退出结论与下游门禁

- [x] **唯一运行计划**：五个业务用点只解析完整六对象发布图；旧 ModelPolicy、环境变量、CLI 和 rule-engine 不再成为模型旁路；
- [x] **真实模型与降级**：LM Studio Gemma 和云端 `gpt-5.5` 均有 Provider token 证据；route 失败/降级严格按同一 `execution_id` 连续记录；
- [x] **route / pinned 隔离**：数据库和 UI 都区分完整路由与指定模型探测，pinned 永不计入路由验证；
- [x] **真实业务**：合同审核、辅助对话、合同起草、标书解析和通用分析当前计划汇总为 `5 / 5 / 5 / 0`；
- [x] **ReviewRun**：真实 15,686 字合同沿当前发布 route 生成 ReviewRun 并绑定源文件身份、计划快照、invocation 和 token；
- [x] **工程与浏览器**：195 files / 1342 tests、lint、typecheck、75-page build、1280×720 与 iPad 1024×1366、无横向溢出、0 console error/warning；
- [ ] **审核准确率**：没有事前独立人工金标，且当前规则发布资产无效，声明保持 `blocked_without_independent_gold`；规则修复进入 WP03，准确率验证由 WP05 恢复门禁管理；
- [ ] **WP09 发布验收**：Production 前完成数据库原子发布、RLS、Hosted 非 localhost 路由和正式发布验收。

### 9.3 WP09 当前五任务验收

第 4 节现行五任务属于 WP09 当前验收，不继承 WP01 的旧版“五任务已通过”结论。WP09 必须在同一 release commit 上重新证明：

- 业务人员按“模型能力 → 业务使用 → 降级顺序 → 实际执行 → 发布与版本”完成主流程，机器对象只作为次级审计详情；
- 页面分别展示管理员配置顺序、本机实际顺序与 Hosted 实际顺序；
- Hosted 排除 local 候选后仍能从首个 cloud 候选形成真实 ReviewRun、`model_invocations` 和 token 证据；
- 草稿、已发布、当前环境实际运行与历史证据没有混为同一状态。

WP02 已由实现提交 `c25ec17a8e51ec6476432ccccf9c30ee0dd9553b` 完成。未完成项没有被隐藏为“整体完成”，而是分别进入 WP03、WP05 和 WP09。

## 10. 历史口径

2026-07-20 之前的 `L1 本地 / L2 云端 / L3 规则兜底`、合同阶段复选框和 `ModelPolicy provider_chain` 是旧运行兼容口径，不再是平台配置产品模型：

- L1/L2 旧 Provider 行已由 WP02 的新六对象发布图取代；历史行只读保留，不再驱动新执行；
- `rule-engine` 不能投影为 Provider 或模型；
- 合同运行阶段属于业务用点、规则/Skill 和运行审计，不回填 Provider；
- 历史 `model_invocations` 继续作为当时运行证据，不改写、不删除；
- WP01 的旧配置只读兼容证据继续保留；WP02 已提供完整新图运行证据，旧运行链不得再作为新业务调用的兼容回退。
