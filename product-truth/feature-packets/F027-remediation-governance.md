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
| 冷登录 | 最近参考样本 `/api/auth/login` 1173ms，整体登录约 1590ms；`dpl_DcsLG4sdNEDESWJiwF12SErXE8iA` 直提样本为 `X-Login-Timing total=1021.6ms`。`c0d23a9` 后登录页改为预热同一路由；`cb176af` 后 Vercel Functions 固化到 `sin1`。最终 `dpl_GPh5F5bZDMwGsTAHuGewTDboEgUe` 预热后提交样本为 166.0ms、120.0ms、112.1ms。 | 正常预热后提交阶段已明显低于 0.5s；但首次预热请求本身仍可能很慢，最终样本一为 2066ms，所以冷启动/外部连接成本仍需监控。 | 保留 `X-Login-Timing`，继续针对剩余冷启动和 `rpc_password_verify` 优化。 |
| 外部网络等待 | 诊断中 Supabase/GitHub TLS reset 曾导致核心 API 拖到约 9s 后 401；网络恢复后核心 API 回到约 185-355ms。 | 外部依赖不是一概删除对象，但必须区分可控代码耗时和不可控网络等待。 | 对外部请求记录错误类别、耗时和降级结果。 |
| 配置中心包体 | 早期诊断样本显示 `/configs` First Load JS 约 281kB；中间构建为 166kB；`c74ad23` 将配置编辑弹窗/表单改为按需加载后，本地生产构建为 `/configs` Size 18kB、First Load JS 159kB，线上登录态 `/configs` 返回 200，页面 chunk 为 61,047 bytes。 | 配置中心首屏专属代码已拆小，但共享 chunk 仍占主要体积，且 `/configs` 仍高于 `/contracts` 144kB、`/tenders` 126kB。 | 持续记录 build 输出；下一步优先看共享 chunk 或 `/admin/org` 245kB，而不是继续盲拆小表单。 |
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
| 首页快速跳转噪声 | `dpl_DcsLG4sdNEDESWJiwF12SErXE8iA` 上快速从 `/` 跳到 `/configs?tab=role-access`，`fastNavigationConsoleMessages=[]`，不再把被导航中止的 dashboard fetch 当作页面错误噪声。 |
| 聚合接口边界 | `/api/admin/org` POST/PATCH 不再承载旧写逻辑，误用时返回 `405`、`Allow: GET`、`ORG_AGGREGATE_READ_ONLY`；写操作复用 `/api/admin/users` 与 `/api/admin/departments`。 |
| 登录 route 预热 | `dpl_7J1TDiARGGbW39XuDRzM8jrrkSuQ` 上 `/login` 自动触发 `GET /api/auth/login` 200；无 header 的 GET 返回 204，不触发数据库预热；有 `X-Login-Prewarm: 1` 才预热。 |
| 函数区域 | `cb176af` 在 `vercel.json` 固化 `"regions": ["sin1"]`；最终部署 `dpl_GPh5F5bZDMwGsTAHuGewTDboEgUe` 的 `vercel inspect` 显示 functions 在 `[sin1]`，`/api/health` 返回 `x-vercel-id hnd1::sin1`。 |
| 冷登录现状 | 预热后提交阶段 `X-Login-Timing total` 为 166.0ms、120.0ms、112.1ms，达到 0.5s route 目标；首次预热请求曾为 2066ms，仍记录为冷启动/外部连接风险。 |
| 配置中心拆包 | `c74ad23` 复用既有 `next/dynamic` 方案，把配置编辑弹窗/表单改为打开时加载；最新生产部署 `dpl_2jd9fa8N5K5hCCrSkcuLbKvS2MMh` Ready，登录态 `/configs` 200，页面 chunk 61,047 bytes。 |
| 本地构建依赖 | 本地缺失的 `@next/swc-darwin-arm64` 生成包/链接已恢复，`pnpm build` 不再出现 SWC fallback warning；剩余 warning 是 Sentry/OpenTelemetry 动态 require。 |
| 部署产物 | 最新生产部署上传 122.5KB；`node_modules`、`.next`、`output`、trace/HAR/video 产物未进入部署包。 |
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
