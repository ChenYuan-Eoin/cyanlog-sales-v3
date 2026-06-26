# Feature Packet: F027-线上问题域闭环治理

**Created**: 2026-06-26
**REQ ID**: F027
**Status**: in_progress
**Type**: cross-domain remediation
**Source**: 用户反馈 60+ 项问题清单、线上截图、生产验证、代码/文档/数据库事实
**Implementation Evidence**: `product-truth/04-implementation-truth/manifests/F027/`

---

## 1. 单元定义

F027 不是一个新增业务功能，而是一次跨问题域的闭环治理单元。

目标是把用户反馈的 60+ 项问题从“标题列表”升级为可追踪的问题域：
- 按业务根因、代码事实、数据流和用户路径合并。
- 先恢复线上可用性，再处理核心业务闭环，再处理性能、冗余、依赖和文档。
- 每个问题域都必须有验收标准和验收证据。
- 文档补全只作为副目标：当设计缺失会影响修复判断、验收标准或后续维护时才补。

这包拥有：
- 问题域合并规则。
- 原始问题到问题域的映射。
- 本轮修复与复用资产记录。
- 验收标准、验收方式、线上发布证据。
- 明确记录未闭环项和下一步。

这包不拥有：
- 替代 `F003/F005/F009/F011/F015-F017` 的产品设计。
- 伪造外部系统成功状态。
- 把临时排查文档长期作为 truth。

---

## 2. 合并原则

本轮不按标题机械合并。合并依据优先级如下：

1. **同一用户路径**：例如合同上传、提交审核、规则执行、报告查看属于同一合同审核闭环。
2. **同一数据事实**：例如 `contract_rules_v2`、`R001-R015`、规则审核页属于同一规则事实。
3. **同一执行边界**：例如配置中心是控制面，合同中心是执行面。
4. **同一发布/运行风险**：例如 Vercel 构建失败、DNS 指向错误、非代码产物上传属于发布治理域。
5. **同一交互/布局根因**：例如移动端横向溢出、按钮遮挡、图片溢出归入移动端与交互可用性。

---

## 3. 问题域总表

| 域 | 问题域 | 原始问题编号 | 根因合并依据 | 验收标准 |
|---|---|---|---|---|
| D01 | 线上可用性与发布治理 | 用户线上不可访问、D5-D9、F1-F10、外部依赖上传问题 | Vercel 构建、DNS、部署 payload、提交门禁同属发布链路 | Production Ready，主域名可访问，构建日志无阻断错误，部署上传边界明确 |
| D02 | 异常路径与性能韧性 | 截图 2、B13-B14、B18、B21-B23、登录性能反馈 | error boundary、404/loading/empty、错误上报、冷登录 RPC 属异常/性能链路 | 异常可恢复，可追踪；关键异常路径浏览器可验证；冷登录瓶颈有 `X-Login-Timing` 分解 |
| D03 | 组织权限与管理员闭环 | A3-A5、B9-B11、E8、G1 | 部门、用户、角色、成员分配、计数和下拉菜单同属 F011 组织权限链路 | 新增/删除成员后 UI、计数、数据库权限绑定一致；菜单可点击 |
| D04 | 外部组织同步闭环 | 外部组织架构同步无下文、A5 相关、F011 飞书同步 | 飞书环境变量、部门同步、结果反馈、幂等写入同属外部组织同步链路 | 未配置时给出明确错误；配置后同步部门并显示新增/更新/总计 |
| D05 | 配置中心与业务执行面一致性 | A2、A9、B7、C3、C8、规则入口问题 | 配置中心合同规则、风险审核、规则执行都消费 `contract_rules_v2` | 线上存在 R001-R015；配置、模拟、风险审核读取同一规则事实 |
| D06 | 合同审核与文档能力闭环 | A8、A10、B12、C5、C7、E1-E7、E9 | 上传、分析、合同详情、文档比对 POST/GET/UI 属 F005 合同能力链路 | 上传到分析结果查看可跑通；比对 POST/GET/UI 可跑通；失败提示明确 |
| D07 | 移动端与交互可用性 | A1、A6-A7、B4、B8、C2、E10 | 移动布局、iPad、favicon、主题图片溢出、按钮反馈同属界面体验 | 桌面/iPad/手机关键页无遮挡、无横向失控；favicon 线上可取 |
| D08 | 知识库新建与空状态 | B5-B6、B21-B23 相关 | `/knowledge`、`/knowledge/new`、`/api/knowledge/pages` 属知识库页面闭环 | 点击新建不 404，创建后跳转详情，API 可读回，可清理临时数据 |
| D09 | 工程冗余与历史资产治理 | B11、B13-B20、C1、C4、D6-D9 | 重复代码、临时文档、alert/console/any/lint/test 属工程治理 | 不新增重复实现；临时文件不入库；lint/typecheck/test/build 通过或有解释 |
| D10 | 外部依赖、非代码上传与构建体积治理 | 用户外部依赖反馈、配置中心包体、非代码上传 | 依赖声明、构建缓存、trace、截图、node_modules、Vercel 上传边界同属交付体积 | 运行时/构建时/部署上传边界区分清楚；不必要产物被忽略或有保留理由 |

---

## 4. 性能事实分层

性能问题不按“页面慢”笼统处理，必须按可观测层级拆分：

| 层级 | 当前事实 | 结论 | 下一步验收 |
|---|---|---|---|
| 页面切换交互 | DevTools trace 显示切页 INP 26ms、CLS 0.00。 | 三页切换本身不是当前主要瓶颈。 | 保留为回归基线，后续只在新增交互后复测。 |
| 冷登录 | 最近参考样本 `/api/auth/login` 1173ms，整体登录约 1590ms；`dpl_DcsLG4sdNEDESWJiwF12SErXE8iA` 直提样本为 `X-Login-Timing total=1021.6ms`。`c0d23a9` 后登录页改为预热同一路由；`cb176af` 后 Vercel Functions 固化到 `sin1`。最终 `dpl_GPh5F5bZDMwGsTAHuGewTDboEgUe` 预热后提交样本为 166.0ms、120.0ms、112.1ms。`bde4752` 后预热覆盖 `login_with_password_v1` 无副作用分支，并新增 `login_rpc_transport`；Preview `dpl_86ysbsC1CGXZjH3YG2mxytNrZzrw` 登录样本为 `total=147.6ms`、`rpc_total=98.4ms`、`login_rpc_transport=39.9ms`。`006f41e` 后慢登录会输出脱敏阶段日志。`762c830` 后预热接口增加 `X-Login-Prewarm-Timing`，并给每个无副作用预热任务默认 1500ms 软边界。 | 暖路径可低于 0.5s，且现在能区分数据库内耗、外部传输等待和预热任务长尾；但生产冷登录仍需等 Preview 切流后在主域复测。 | 保留 `X-Login-Timing`、`X-Login-Prewarm-Timing`，用 `rpc_password_verify`、`login_rpc_transport`、预热任务状态和慢日志分别跟踪数据库计算、外部等待与线上长尾。 |
| 外部网络等待 | 诊断中 Supabase/GitHub TLS reset 曾导致核心 API 拖到约 9s 后 401；网络恢复后核心 API 回到约 185-355ms。`762c830` 的本地生产验证中，`POST /api/auth/prewarm` 对 `login_rpc` 返回 `dur=1501.8;status=timed_out` 并输出脱敏 `[auth/login] prewarm timeout`。 | 外部依赖不是一概删除对象，但必须区分可控代码耗时和不可控网络等待；机会型预热不能无限占用请求。 | 对外部请求记录错误类别、耗时和降级结果；生产部署后用预热 header 和日志复测。 |
| 配置与组织包体 | 早期诊断样本显示 `/configs` First Load JS 约 281kB；中间构建为 166kB；`c74ad23` 后为 160kB；`56ba7e3` 将配置编辑弹窗和版本历史弹窗整体移出首包后，最新本地构建 `/configs` 为 Size 15.4kB、First Load JS 129kB。`0d15f8c` 将 `/admin/org` 的组织工作台动态加载后，生产构建从 73.2kB / 245kB 降到 3.78kB / 107kB，线上 chunk 9,078 bytes；`4bc49c6` 保持 `/admin/org` 为 3.78kB / 107kB。 | 两个配置/组织入口的首屏专属代码已拆小；`/configs` 已低于 `/contracts` 144kB，接近 `/tenders` 126kB，剩余关注点是共享 chunk 和真实首次进入耗时。 | 持续记录 build 输出；下一步优先看共享 chunk 或真实 first-entry trace，而不是继续盲拆小表单。 |
| 登录页 CLS | 登录页 trace 曾显示 CLS 约 0.21；`be7c882` 后线上桌面 1440x900 与手机 390x844 采样均为 CLS 0。 | 当前登录页布局稳定性已恢复；CLS 属登录页问题，不属于配置/合同/标书切页问题。 | 保留为回归基线，后续主题/品牌变更后复测。 |

本轮不保留未经验证的性能改动。曾尝试把登录预热从 1200ms 提前到 350ms，但快速提交样本退化到约 5s，因此撤销；后续必须先补观测，再做优化。当前生产环境中 Vercel 未透出应用设置的 `Server-Timing`，所以登录链路以镜像 header `X-Login-Timing` 作为验收证据。

---

## 5. 历史资产复用

| 资产 | 复用方式 |
|---|---|
| `F000-config-center-architecture.md` | 继续作为配置中心三层架构和控制面/执行面边界。 |
| `F005v2-contract-center.md` | 复用合同上传、风险审核、文档比对的用户路径和验收口径。 |
| `F009-contract-rule-config.md` | 复用 R001-R015、`contract_rules_v2`、规则消费边界。 |
| `F011-org-permission-config.md` | 复用组织架构、角色权限、飞书部门同步 MVP 范围。 |
| `LoadingState` / `EmptyState` / `app/error.tsx` / `app/not-found.tsx` | 复用现有异常、loading、empty、404 资产，不再新增重复组件。 |
| `loadHomeInitialData` / 首页已有数据加载链路 | 复用现有首页数据加载与预热入口，补 abort/suppress stale fetch 逻辑，避免快速跳转时产生伪错误。 |
| `/api/auth/prewarm` 预热思路 | 没有新增第二套登录 API；抽出 `warmLoginRuntime`，旧预热路由继续可用，登录页改为预热同一个 `/api/auth/login` route bundle。 |
| `app/api/contracts/[id]/compare/route.ts` | 复用现有合同比对 API，补齐 GET/POST/UI 验证。 |
| `app/api/knowledge/pages` 与 `app/knowledge/new` | 复用现有知识库页面管理能力，验证新建闭环。 |
| Vercel rootDirectory 配置 | 复用 `product-truth/product-code` 作为真实应用根，补充 `.vercelignore` 而不是改变项目结构。 |

---

## 6. 本轮补齐的设计/文档

| 文档 | 原因 | 补齐范围 |
|---|---|---|
| `F011-org-permission-config.md` | 外部组织同步范围不清会影响验收判断。 | 明确飞书 MVP 只同步部门结构，未配置时必须反馈缺失环境变量和配置位置。 |
| `F027-remediation-governance.md` | 缺少跨问题域合并、验收、发布证据的稳定 truth。 | 将 60+ 问题合并为 10 个问题域，并定义验收与剩余风险记录方式。 |
| `04-implementation-truth/manifests/F027/*` | 需要保留本轮线上证据、命令证据、发布证据。 | 记录当前验证结果、部署 ID、线上路径、剩余风险。 |
| `04-implementation-truth/manifests/F027/api-validation-inventory.md` | API schema 覆盖债务不能只用粗略数量表达，否则容易把 manual guard 误判为已完成或未修复。 | 固化 103 个 API route 的 body-parse 分类：67 个 `schema+guard`、0 个 `guard-only`、36 个 `no-body`；ASK 回应路由按已测试的共享 helper schema 计入。 |

---

## 7. 批次定义

| 批次 | 覆盖问题域 | 完成信号 |
|---|---|---|
| P0 | D01、D02、合同详情错误 | 主域名可访问，合同详情不进入 error boundary，Production Ready。 |
| P1 | D03-D06、D08 | 管理员、规则、合同上传/比对、知识库新建的线上用户路径可跑通。 |
| P2 | D07 | 手机/iPad 核心页面无横向失控，favicon 线上可取。 |
| P3 | D09-D10 | 临时文件不入库，部署上传边界明确，质量命令通过。 |
| P4 | 长期治理 | 冷登录 RPC、真实飞书同步、Sentry/OTel warning、legacy rules 等进入后续治理。 |

---

## 8. 最新线上验收补记

2026-06-26 的组织权限闭环补丁没有按“改了代码即完成”验收，而是按用户路径验收：

| 验收点 | 线上结果 |
|---|---|
| 首屏组织数据 | `/configs?tab=org-structure` 初始加载显示 `...`，加载完成后为 11 部门、25 成员、3 销售空间，没有 false 0。 |
| 新增管理员 | 新增 `codex-live-admin-1782459054@example.com` 后，成员数 25=>26，第一行显示临时管理员与管理员角色。 |
| 停用/启用 | 停用后成员数仍为 26，状态显示 `已停用`，菜单变为 `启用用户`；启用后状态回到 `在职`。 |
| 删除 | 删除后成员数 26=>25，临时成员从列表消失。 |
| 数据清理 | 验收账号已在数据库层硬删除；RPC 复核 25 用户、11 部门、7 角色、3 销售空间，临时账号不再出现在 payload。 |
| 部门主管字段 | `dpl_GA7vgxSXz3zLjLt8fUc7WhBdrh17` 上创建临时部门并指定主管 `张雪丽`，配置中心组织架构页面可见部门与主管；临时部门已硬删除。 |
| 软删除部门过滤 | 临时部门软删除后一度仍出现在 `/api/admin/org`，已通过 `20260626155732_org_admin_active_departments_only.sql` 和 fallback 过滤修复；最终 payload 回到 11 部门。 |
| 组织缓存再验证 | 同一浏览器里，清理临时部门后 `/configs?tab=org-structure` 会重新请求 `/api/admin/org` 并移除缓存中的旧部门；console warnings/errors 为 0。 |
| 管理员角色增删刷新 | `dpl_DcsLG4sdNEDESWJiwF12SErXE8iA` 上通过 UI 新增 `codex-admin-1782463975754@example.com` 后立即可见；加入管理员角色后 `role_codes=["ADMIN"]`；移出后从管理员已分配列表消失且 `role_codes=[]`；临时账号已硬删除，最终仍为 25 人。 |
| 组织聚合耗时分层 | `4bc49c6` 在 `/api/admin/org` 响应中加入 `X-Org-Payload-Source` 和 `X-Org-Timing`；最新生产部署 `dpl_DDfZfD9oNiuRgdA4EkNYExFAb1ic` 上真实登录后返回 `source=rpc`、`auth;dur=0.2, rpc_payload;dur=55.5, total;dur=55.9`、25 用户 / 11 部门 / 7 角色 / 3 销售空间。 |
| 管理员写接口参数校验 | `/api/admin/users/[id]/departments`、`/login-enabled`、`/report-to` 增加 Zod body/query 校验；坏参数返回 `400 VALIDATION_ERROR`，并由测试确认不会访问 Supabase。最新生产部署同样对空 `department_ids`、字符串 `login_enabled`、非法 `report_to_user_id` 返回 400。API Zod 覆盖从 36/103 提升到 39/103。 |
| 管理员写接口 JSON 分类 | `8dd29e3` 复用既有 Zod schema 与 route 测试体系，把 `/api/admin/departments`、`/api/admin/departments/[id]`、`/api/admin/users`、`/api/admin/users/[id]`、`/api/admin/users/[id]/roles` 的 malformed JSON 从 generic 500 改为 `400 VALIDATION_ERROR`；最新生产部署五条线上样本均返回 400。 |
| 认证与通用接口 JSON 分类 | `1a521a4` 将同一处理方式扩展到 `/api/auth/login`、`/api/auth/register`、`/api/auth/change-password`、`/api/profile`、`/api/client-errors`；`cdc118c` 将 public API allowlist 改为精确匹配并放行旧注册入口 `/api/auth`。`dpl_6ZME8coENZdgts2ThnPkjq21xez4` 线上验收中 `/api/auth` 与 `/api/auth/register` malformed JSON 均为 400，`/api/auth/me`、`/api/auth/login-extra`、`/api/health-extra` 未登录仍为 401。 |
| 配置中心写接口 JSON 分类 | `ff9f4bd` 复用既有配置 schema，让 `/api/configs`、`/api/configs/[id]`、`/api/configs/[id]/rollback` 的 malformed JSON 进入 400 校验分支；`dpl_GCdMNrSB1RQj1jtxcabmsV6zrr5e` 三条线上样本均返回 400。 |
| 配置中心派生 API envelope | `44adc21` 将 `/api/configs/[id]`、`/publish`、`/versions`、`/rollback` 从旧 `{ error, code }` / 裸数据响应收敛到 `lib/api/common` 的 `{ success, data/error }`。`ConfigsClient` 同时兼容新旧错误对象和版本列表响应，避免前端把 error object 直接渲染成 React child。目标测试 3 个文件 / 3 个用例、定向 lint、typecheck、build 和浏览器登录态配置页验证均通过。 |
| 知识库写接口 JSON 分类 | `6609af8` 复用既有知识库页面处理器，让 `/api/knowledge/pages/[id]` 与 `/api/knowledge/pages/[id]/permissions` 的 malformed JSON 进入 400 `VALIDATION_ERROR` 分支；`dpl_DDfZfD9oNiuRgdA4EkNYExFAb1ic` 线上没有现存页面，验收脚本创建临时页面后验证两条 malformed JSON 样本，并已删除临时页面。 |
| 内容类 CRUD 写接口 JSON 分类 | `4f0d2c5` 复用 agenda/cases/roles/tech-documents/business-qualifications 既有 Zod schema，不新增业务通道，只把 JSON 解析失败接入既有 400 分支；`dpl_7UUQDoCrx3NTSerYwFb8js1MBKUU` 线上六条 malformed JSON 样本均为 400，目标测试和全量测试确认坏 JSON 不访问 Supabase。 |
| 规则域写接口 JSON 分类 | `d226737` 复用既有 rules 路由和错误合约，将 body 解析/校验前移到规则/组织查询之前；`dpl_9nospHMt9Jn52muVo6uxownWoNi4` 线上七条 malformed JSON 样本均为 400，测试确认坏 JSON 不触发 default-org、规则引擎或 Supabase。 |
| 报价与商品写接口 JSON 分类 | `f3939d5` 复用 products/quotes/price-tier 既有 schema 和错误合约，将 body 解析/校验前移到 org/SKU/报价查询之前；`dpl_BCq57B8W6Bi4LkFXmf4Q8v562Qbm` 线上六条 malformed JSON 样本均为 400，测试确认坏 JSON 不触发 org、定价计算或 Supabase。 |
| AI 与合同接口 JSON 分类 | `de3fc9c` 处理剩余 AI/合同路由裸 `req.json()` 风险：`/api/ai/analyze`、`/api/contracts`、`/api/contracts/[id]`、`/api/contracts/[id]/merge-chunks`、`/api/contracts/[id]/clauses/[clauseId]`。`app/api` 裸 JSON 解析扫描已清零；`dpl_8ppMSoM9i8vFdLSeLfPZebFkQiV5` 线上五条 malformed JSON 样本均为 400，测试确认坏 JSON 不进入可避免的模型、组织、数据库、存储或合同访问链路。 |
| API schema 覆盖债务清单 | `api-validation-inventory.md` 对 103 个 API route 做二次收窄扫描，只统计 `req/request` body parser，不把 `NextResponse.json` 误计为请求体读取。当前结果为 0 个 `unguarded-body`、67 个 `schema+guard`、0 个 `guard-only`、36 个 `no-body`。两个 ASK 回应路由按已测试的共享 helper schema 计入，这把“不会因坏 body 崩掉”和“已经有完整业务 schema”拆开记录。 |
| 合同策略版本动作 schema | `64839e2` 将 `/api/contract-policies/rules/[id]/versions/[versionId]/publish` 与 `/rollback` 从 `guard-only` 收敛到 `schema+guard`。复用既有 `errorResponse/createApiError/withAuthAndOrg`，不改发布/回滚数据库流程；坏 JSON 与字段类型错误在鉴权和 Supabase 前返回 400。 |
| 规则动作 schema | `9b8d765` 将 `/api/rules/[id]/test`、`/api/rules/[id]/versions`、`/api/rules/simulate` 从 `guard-only` 收敛到 `schema+guard`。保留原鉴权顺序和错误文案，坏 JSON 与字段类型错误不会进入组织查询、Supabase 或规则引擎。 |
| 规则回滚 schema | `5e31674` 将 `/api/rules/[id]/rollback` 从 `guard-only` 收敛到 `schema+guard`。复用既有回滚数据库流程和错误文案，只把 `version` 请求体收紧为正整数；坏 JSON 与字段类型错误不会进入默认组织查询或 Supabase。 |
| ASK 回应共享 schema | `614449c` 没有新增第二套 ASK 回应 schema，而是用路由入口测试确认 `/api/asks/[askId]/responses` 与 `/api/contracts/[id]/asks/[askId]/responses` 复用既有 `submitAskResponse` Zod schema；坏 JSON 与错误 `response_text` 类型会返回 400 `V001`，不会进入合同访问或 Supabase。 |
| 合同条款/标准对照 schema | `bb83afa` 将 `/api/contracts/[id]/compare-standard` 与 `/api/contracts/[id]/clauses/[clauseId]` 从 `guard-only` 收敛到 `schema+guard`。标准对照坏 body 不进入 `withAuthAndOrg`；条款状态更新保留既有 `INVALID_JSON` / `INVALID_STATUS` 响应形态，坏状态不会进入合同查询或 Supabase。 |
| 后台配置 schema | `5ad61c4` 将 `/api/admin/review-strategies`、`/api/admin/clause-library`、`/api/admin/clause-library/[id]` 从 `guard-only` 收敛到 `schema+guard`。保留 admin 鉴权顺序和既有错误码，坏 JSON 与字段类型错误不会进入 Supabase。 |
| 知识库页面 schema | `8115000` 将 `/api/knowledge/pages/[id]` 与 `/api/knowledge/pages/[id]/permissions` 从 `guard-only` 收敛到 `schema+guard`。保留既有鉴权/访问控制顺序，页面字段、权限授予和权限删除 ID 的坏形状不会进入 Supabase。 |
| 合同分析/标书工作流 schema | `a7969db` 将 `/api/contracts/[id]/analyze` 与 `/api/tenders/[id]/workflow` 从 `guard-only` 收敛到 `schema+guard`。非法审核策略不进入合同查询或任务创建；非法工作流方向不再被当作上一步处理，坏 checkpoint 不进入标书更新。 |
| 上传与分片路由 schema | `172f83b` 将最后 5 条请求体路由 `/api/contracts/[id]/merge-chunks`、`/api/contracts/[id]/upload`、`/api/contracts/[id]/upload-chunk`、`/api/tenders/ocr`、`/api/upload` 收敛到 `schema+guard`。坏 JSON、坏 multipart、缺失文件、坏分片参数和不支持文件类型均在组织、Supabase、Storage、OCR 或文本解析前返回 400；全量 hook 验收为 99 个测试文件 / 416 个测试通过，`pnpm build` 通过且只保留已知 Sentry/OpenTelemetry warning。 |
| 上传/OCR 响应 envelope | `d1f0b49` 将 `/api/upload` 与 `/api/tenders/ocr` 的错误响应统一为 `{ success:false, error:{ code,message } }`，成功响应统一为 `{ success:true, data }`；`ImageUpload` 读取新旧两种成功/错误字段，避免过渡期前端上传中断。目标测试为 2 个路由测试文件 / 10 个用例通过，hook 全量为 99 个测试文件 / 417 个测试通过，`pnpm build` 通过且只保留已知 Sentry/OpenTelemetry warning。 |
| 合同上传异常路径前置校验 | `cbda92e` 复用既有上传页、`useChunkUpload` 和合同上传接口，没有新增第二套上传链路；`/api/contracts/[id]/upload` 与 `/upload-chunk` 先校验表单/文件/分块参数，再进入组织、合同、Storage 或文本解析。`dpl_8S8N46tAtGhruQf8AALfHhM4DpUW` 线上 6 条坏表单/坏文件样本均返回 400 common envelope，浏览器登录后 `/contracts/upload` 正常渲染拖拽上传区和分块说明。 |
| 通用资产上传与拖拽反馈 | `7d7561a` 复用既有 `/api/upload` 和 `ImageUpload` 组件，没有新增第二套头像/主题图片上传链路；坏 multipart、缺失文件、非图片文件会在进入 Storage 前返回 400。`dpl_65KRcDFdHHcYMEjePwueSjNYXuJ5` 线上 3 条坏表单样本均为 400；浏览器 `/profile` 编辑态显示头像上传控件，`dragover` 后 drop zone 切到 `bg-blue-50 border-blue-500`，`dragleave` 后恢复普通态。 |
| 错误边界返回首页恢复 | `778073d` 复用既有首页预热资产 `primeHomeInitialData`，错误页挂载时先 `router.prefetch('/')` 并预热首页数据；错误上报延后到下一轮任务并优先使用 `sendBeacon`，避免错误态下和“返回首页”操作争抢网络。`dpl_54XuYRed9j38EJuAzyBQ5vwVc8Z6` 上 `/` 与用户截图合同详情 URL 均正常渲染，合同详情不再出现 `页面发生错误`。 |
| 剩余表单解析边界 | `6b0bd77` 处理 `app/api` 中剩余裸 `formData()`：登录表单、商品创建、合同创建 FormData 分支和标书 OCR 上传。坏 multipart 均进入 400 校验分支，不再落入 generic 500 或提前触发可避免的 RPC/组织/数据库/OCR 解析。`dpl_BpwMSoQQz15UXMk7qf7yTVAkVaew` 线上四条坏表单样本均返回 400。 |
| 合同列表分页与卡片反馈 | 复用既有 `/api/contracts` 分页、`loadContractsListForCache`、`LoadingState` 和合同中心任务卡片，没有新增第二套列表 API。`app/contracts/page.tsx` 将分页交互改为 `加载更多` 追加模式；搜索后加载下一页保留 `search=`；任务卡片改为 block 级链接并补齐 focus-visible、hover、active 反馈。Local production browser mock 验证：初始 20 条，搜索 `华润` 后加载更多请求 `/api/contracts?page=2&pageSize=20&search=...`，结果追加到 22 条，桌面 1440x900 与手机 390x844 均无横向溢出和错误页。 |
| 组织/角色刷新闭环 | `632f286` 没有新增第二套组织管理实现，而是复用 `/api/admin/org`、`/api/roles`、`browser-cache` 和既有组织权限 UI，把组织结构与角色权限缓存作为同一数据域失效。浏览器在本地生产服务和线上 Preview `dpl_7vB2iPaZCwzh4QFMXPbixhv2Jx9t` 均验证通过：飞书未配置反馈可见；新增带 ADMIN 角色的临时成员后，组织页和管理员角色页都立即可见；UI 删除后管理员角色页剩余匹配行数为 0；临时成员清理复核为 0。 |
| 登录 RPC 预热与外部等待拆分 | `bde4752` 复用既有 `/api/auth/login` 预热入口和 `login_with_password_v1`，用空参数命中 input validation 分支，避免写入登录尝试或 token；同时在 `X-Login-Timing` 增加 `login_rpc_transport`，明确外层 Supabase/PostgREST/网络/序列化等待。Preview `dpl_86ysbsC1CGXZjH3YG2mxytNrZzrw` 验证：health 200、数据库 120ms；prewarm 200；login 200，`total=147.6ms`、`rpc_total=98.4ms`、`login_rpc_transport=39.9ms`。`762c830` 继续复用这两条预热入口，没有新增登录 API；本地生产 `GET /api/auth/login` 预热响应带 `users_query/candidate_rpc/login_rpc` 阶段 header，`POST /api/auth/prewarm` 在 `login_rpc` 超过 1500ms 时返回 `status=timed_out`。 |
| 慢登录阶段日志 | `006f41e` 复用现有 login timing collector，没有新增第二套性能埋点；当 `/api/auth/login` route total >=500ms 时输出脱敏 `[auth/login] slow timing` warning，包含 `login_rpc`、`rpc_token_write`、`rpc_initial_dashboard`、`rpc_initial_core`、`login_rpc_transport`、`auth_context_cookie` 等阶段耗时。单元测试确认日志不包含邮箱、用户 ID 或展示名。 |
| 最新 Preview 视觉验收 | `dpl_86ysbsC1CGXZjH3YG2mxytNrZzrw` 通过临时 Vercel share URL 在真实浏览器中打开 `/login`、`/`、`/configs?tab=role-access`。桌面 1440x900 和手机 390x844 截图均无 `页面发生错误`；首页、配置中心角色权限桌面和移动端均无横向溢出；移动端汉堡按钮可见，角色成员新增入口可见。截图保存在 ignored 的 `product-truth/product-code/output/playwright/` 下，只作为本地证据，不进入 Git 或 Vercel payload。 |
| 生产切流阻塞 | `bde4752` 已提交并推送，手动 Preview `dpl_86ysbsC1CGXZjH3YG2mxytNrZzrw` 已 Ready 并通过登录 timing 与视觉 smoke 验证；`001f9cc` 合同列表修复、`d5dd3ac` Sentry no-DSN guard、`006f41e` 慢登录阶段日志、`64839e2` 合同策略版本动作 schema、`9b8d765` 规则动作 schema、`5e31674` 规则回滚 schema、`614449c` ASK 回应共享 schema、`bb83afa` 合同条款/标准对照 schema、`5ad61c4` 后台配置 schema、`8115000` 知识库页面 schema、`a7969db` 合同分析/标书工作流 schema、`172f83b` 上传/分片/OCR/资产路由 schema 和 `d1f0b49` 上传/OCR envelope 也已通过本地验收。但重复执行 `vercel promote` 以及针对 `001f9cc` / `9e593c0` 的 `vercel deploy --yes` 都被 Vercel 限额 `api-deployments-free-per-day` 拦截，最新一次正确根目录部署上传 178.4KB 后失败。因此 `sales.cyanlog.icu` 仍指向旧 production `dpl_BpwMSoQQz15UXMk7qf7yTVAkVaew`，最新代码不能写成线上主域完成。 |
| 合同详情错误边界复核 | `dpl_8ppMSoM9i8vFdLSeLfPZebFkQiV5` 上用浏览器打开用户截图中的 `/contracts/44301b16-6551-4720-afa5-f1d80b1604de`，页面渲染标题、基本信息、审核任务和 AI 风险点，不再显示 `页面发生错误`。 |
| 首页快速跳转噪声 | `dpl_DcsLG4sdNEDESWJiwF12SErXE8iA` 上快速从 `/` 跳到 `/configs?tab=role-access`，`fastNavigationConsoleMessages=[]`，不再把被导航中止的 dashboard fetch 当作页面错误噪声。 |
| 聚合接口边界 | `/api/admin/org` POST/PATCH 不再承载旧写逻辑，误用时返回 `405`、`Allow: GET`、`ORG_AGGREGATE_READ_ONLY`；写操作复用 `/api/admin/users` 与 `/api/admin/departments`。 |
| 登录 route 预热 | `dpl_7J1TDiARGGbW39XuDRzM8jrrkSuQ` 上 `/login` 自动触发 `GET /api/auth/login` 200；无 header 的 GET 返回 204，不触发数据库预热；有 `X-Login-Prewarm: 1` 才预热。 |
| 函数区域 | `cb176af` 在 `vercel.json` 固化 `"regions": ["sin1"]`；最终部署 `dpl_GPh5F5bZDMwGsTAHuGewTDboEgUe` 的 `vercel inspect` 显示 functions 在 `[sin1]`，`/api/health` 返回 `x-vercel-id hnd1::sin1`。 |
| 冷登录现状 | 预热后提交阶段 `X-Login-Timing total` 为 166.0ms、120.0ms、112.1ms；`6aac024` 缓存 auth context HMAC key 后，生产登录 route total 为 315.0ms、154.5ms、124.5ms、110.3ms、109.8ms，其中 `auth_context_cookie` 首次 13.8ms、后续 0.4-0.5ms。`bde4752` Preview 登录 route total 为 147.6ms，`login_rpc_transport` 为 39.9ms。`006f41e` 后慢登录会在服务器日志留下脱敏阶段摘要。生产主域仍停在旧部署，不能按该样本关闭生产冷登录。 |
| 配置中心拆包 | `56ba7e3` 复用既有 `next/dynamic` 方案，把配置编辑弹窗和版本历史弹窗整体改为打开时加载，没有新增第二套配置 UI；最新本地构建为 `/configs` 15.4kB / 129kB，低于 `/contracts` 144kB。浏览器使用本地生产服务验证：真实登录后税率新增弹窗、主题新增弹窗均能加载，控制台错误和真实网络失败为空。 |
| 组织管理拆包 | `0d15f8c` 复用同一动态加载方案，把 `/admin/org` 的组织工作台延后加载；最新生产部署 `dpl_GCdMNrSB1RQj1jtxcabmsV6zrr5e` 登录态 `/admin/org` 200，页面 chunk 9,078 bytes；最新构建仍为 `/admin/org` 3.78kB / 107kB。 |
| 本地构建依赖 | 本地缺失的 `@next/swc-darwin-arm64` 生成包/链接已恢复，`pnpm build` 不再出现 SWC fallback warning；`4507ae2` 通过 `serverExternalPackages` 让 Sentry/OpenTelemetry Node instrumentation 走 server external，不再出现 `require-in-the-middle` dynamic require warning；`56ba7e3` 最新构建继续无该 warning。 |
| Sentry 无 DSN 启动噪声 | `instrumentation.ts` 在没有 `SENTRY_DSN` 和 `NEXT_PUBLIC_SENTRY_DSN` 时不再导入 server/edge Sentry 配置；本地 `next start -p 3000` 不再输出 server Sentry disabled warning。构建期 OpenTelemetry dynamic require warning 已由 `4507ae2` 的 `serverExternalPackages` 关闭，不通过关闭监控来消除。 |
| Sentry/OpenTelemetry 构建 warning | `4507ae2` 复用 Next `serverExternalPackages`，不关闭 Sentry 监控，只让 `@sentry/nextjs` / `@sentry/node` / `@opentelemetry/instrumentation` / `require-in-the-middle` 退出 server bundling。Local `pnpm build` 不再出现 Sentry/OpenTelemetry dynamic require warning；`next start -p 3010` Ready，`GET /api/health` 返回 200。 |
| Vercel 生产部署额度 | `bde4752` 的 Preview `dpl_86ysbsC1CGXZjH3YG2mxytNrZzrw` 已 Ready，但 `762c830` 最新代码尚未获得新的 Ready Preview；`1cd121d` pushed branch head 的 repo-root 部署上传 232.2KB 后仍被免费每日部署额度拒绝，错误码为 `api-deployments-free-per-day`。 | 等额度恢复或提升额度后，优先 deploy 当前最新 HEAD；再在新 Preview 与 `sales.cyanlog.icu` 重跑登录预热等待边界、配置中心拆包、配置派生 API envelope、Sentry/OpenTelemetry build-log check、上传/OCR envelope、上传/分片/OCR/资产路由 schema、合同分析/标书工作流 schema、知识库页面 schema、后台配置 schema、合同条款/标准对照 schema、ASK 回应共享 schema、规则回滚 schema、规则动作 schema、合同策略版本动作 schema、合同分页、Sentry no-DSN 启动、慢登录阶段日志、组织/角色刷新和登录 timing 验收流。 |
| 部署产物 | 最新成功生产部署为 `dpl_BpwMSoQQz15UXMk7qf7yTVAkVaew`，上传 184.6KB；`bde4752` 手动 Preview `dpl_86ysbsC1CGXZjH3YG2mxytNrZzrw` 上传 164.2KB；`001f9cc` Preview 尝试上传 155.3KB 后被 Vercel 每日额度拒绝；`9e593c0` repo-root 部署尝试上传 178.4KB 后同样被额度拒绝；`4507ae2` repo-root 部署尝试上传 305.5KB 后仍被额度拒绝；`95f4268` repo-root 部署尝试上传 218.0KB 后仍被额度拒绝；`1cd121d` repo-root 部署尝试上传 232.2KB 后仍被额度拒绝。项目根仍是 `product-truth/product-code`；tracked app 文件合计 4.1MB，tracked 仓库合计 18MB；本地 `node_modules` 1.2GB、`.next` 1.0GB、`output/playwright` 截图证据和 `tsconfig.tsbuildinfo` 都被 ignore，没有进入 Git 或 Vercel payload。 |
| Sharp 构建脚本 | `7eded60` 只批准 `sharp` 进入 `pnpm.onlyBuiltDependencies`；`dpl_F8ZGdXqXQU3LDKU9YbatoZE9Yxhm` 执行 `sharp@0.34.5 install/check.js` 并完成，后续生产构建不再出现 ignored build scripts warning。 |
| 测试命令噪声 | `pnpm test:run` 固化 `NODE_OPTIONS=--no-experimental-webstorage` 后，当前 hook 全量测试为 99 个测试文件 / 418 个测试通过，且不再输出 Node 24 `--localstorage-file` warning。 |
| Lint 命令噪声 | `pnpm lint` 从 `next lint` 切到 ESLint CLI，覆盖 `app/components/lib/types` 与根运行配置文件；命令通过且不再输出 Next 16 废弃提示。 |
| 临时产物治理 | 7 个历史 `.playwright-mcp` log/snapshot 文件已从 Git 移除，并补齐 `.gitignore` / `.vercelignore`。 |

这次复用了既有组织权限 UI、`/api/admin/users`、`/api/admin/departments`、`/api/admin/org` 读取聚合和 Supabase migration 链路；新增的是部门主管字段入库、聚合只读边界、软删除部门过滤和组织 tab 缓存再验证，没有新增第二套组织管理工作台。

---

## 9. 完成定义

F027 不能用“有代码修改”作为完成标准。完成必须同时满足：

- 生产部署 Ready，主域名可访问。
- 原始问题已映射到问题域，且每个问题域有验收结论。
- 核心业务流程有浏览器或 API 验收。
- `lint` / `typecheck` / `test` / `build` 至少达到当前项目门槛。
- 临时排查产物不进入 git，不参与部署上传。
- 剩余风险必须明确是代码未完成、外部配置未满足，还是长期优化项。
