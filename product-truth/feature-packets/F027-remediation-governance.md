# Feature Packet: F027-线上问题域闭环治理

**Created**: 2026-06-26
**REQ ID**: F027
**Status**: in_progress
**Type**: cross-domain remediation
**Source**: 用户反馈 60+ 项问题清单、线上截图、生产验证、代码/文档/数据库事实
**Implementation Evidence**: `product-truth/04-implementation-truth/manifests/F027/`

---

## 0. 2026-06-30 重开状态

2026-06-30 用户线上截图显示：组织架构、角色权限、主题/品牌配置、合同审核规则、合同中心入口和飞书同步仍存在明显验收失败或产品语义偏差。

因此，本文档中 2026-06-26 的线上验收记录只能作为历史证据，不能继续作为 F027 已闭环结论。

本次重开后的需求清单补充已收敛到 `product-truth/REQ_REGISTRY.yml`：

- `audit_supplement.active_problem_domains` 记录 PD01-PD10 问题域。
- `F000` 补入配置中心共享架构注册项。
- `F003 / F005v2 / F005 / F006 / F007 / F009 / F011 / F012 / F027` 补入当前缺口、补充需求和验收要求。

后续 F027 的输出物不再是“改了多少项”的流水账，而必须是：

```
问题域 -> Bug ID -> 关联 REQ -> 代码/文档/数据证据 -> 修复批次 -> 验收标准 -> 线上证据 -> 收尾结论
```

完成信号以问题域验收矩阵为准，不以提交数量、修改文件数量或历史一次性截图为准。

---

## 0.0 主目标与子目标结构

F027 的主目标不是“把 60 多个标题逐条改掉”，而是把当前线上反馈、历史 Bug、需求缺失和代码事实归并到同一个产品闭环里。

**主目标 G0：商业产品第一阶段闭环恢复。**

把 ONES Sales 从“功能堆叠 + 临时修补”恢复为可持续迭代的商业产品第一阶段。第一阶段允许能力不完整，但不允许关键结构被写死或伪完成。

| 子目标 | 目标 | 问题域 | 关联需求 | 完成证据 |
|---|---|---|---|---|
| G1 | 需求与问题资产治理 | PD01 / PD09 / PD10 | RQ-GOV-001 / RQ-GOV-002 / RQ-NOISE-001 | Bug 清单能反查主目标、REQ、代码/数据证据、验收标准和收尾结论。 |
| G2 | 合同审核产品闭环 | PD04 / PD05 / PD07 | RQ-CON-002 / RQ-CON-003 / RQ-WORD-001 | 合同版本、ReviewRun、RiskFinding、谈判、客户反馈、批注、报告形成可验收链路。 |
| G3 | 审核规则与 Skill 闭环 | PD03 / PD06 | RQ-RULE-001 / RQ-RULE-002 / RQ-SKILL-001 / RQ-MODEL-001 | 审核依据来自配置中心发布规则和 SkillBundle，而不是通用 prompt 或当前表状态。 |
| G4 | 配置中心数据底座 | PD02 / PD03 / PD08 | RQ-CFG-001 / RQ-THEME-001 / RQ-RULE-001 | 组织、角色、主题、规则、模型策略均区分真实空、加载失败、未授权和未发布。 |
| G5 | 组织权限与外部同步 | PD02 / PD08 | RQ-AUTH-001 / RQ-ORG-001 / RQ-ORG-002 / RQ-EXT-001 | 超管、管理员、普通用户与飞书同步失败态均可复测。 |
| G6 | 合同中心信息架构 | PD04 / PD05 | RQ-CON-001 / RQ-CON-004 | 起草、上传、风险审核、文档比对四个入口语义不同，前置条件和结果页不同。 |
| G7 | API 与数据一致性 | PD02 / PD03 / PD06 / PD09 | RQ-ERR-001 / RQ-QA-001 | API 错误不被渲染为空数据；schema、权限、响应 envelope 和测试覆盖对齐。 |
| G8 | 前端体验与响应式 | PD04 / PD09 | RQ-QA-001 / RQ-ERR-001 | 桌面、iPad、移动端真实浏览器无遮挡、不可点、错误边界和横向溢出。 |
| G9 | 性能与稳定性 | PD09 / PD10 | RQ-QA-001 / RQ-NOISE-001 | 冷登录、配置中心首入、异常返回首页、外部依赖等待和构建体积有指标证据。 |
| G10 | 发布与验收治理 | PD09 / PD10 | RQ-GOV-002 / RQ-QA-001 | lint/typecheck/test/build、真实浏览器、移动端、线上 Vercel Ready/Production 证据齐全。 |
| G11 | 文档与噪音治理 | PD01 / PD10 | RQ-GOV-001 / RQ-NOISE-001 | 主文档和 F0xx 对齐；临时文档、trace、截图、本地依赖有保留/归档/删除结论。 |

文档补全只作为上述子目标的支撑动作。凡是不能影响需求、代码、测试或验收的文档追加，视为噪音。

Bug 合并规则：

- 同一根因、同一对象、同一接口/状态机、同一验收证据，才允许合并。
- 仅标题相似、页面相近、文案相似，不能合并。
- 合并后必须保留原始用户反馈来源，避免“合并后看不见原问题”。

目标使用规则：

- G1 是入口治理目标，负责把需求、Bug、证据和状态先归位；它不等于业务完成。
- G2/G3/G4/G5/G6/G7 是产品和代码主战场，必须用真实页面、API、数据和文档共同验收。
- G8/G9/G10/G11 是横向门禁，不能替代业务修复，但可以阻止“看似修完”的批次进入完成状态。
- 一个 Bug 可以服务多个目标，但必须指定主归属；主归属决定修复批次和最终验收口径。
- 状态只能按证据推进：`待确认` -> `已确认` -> `修复中` -> `本地已验证` -> `线上已验证` -> `收尾完成`。
- `待设计补齐` 不是延期借口；只有对象、接口、状态机或验收口径确实缺失时才使用，并且必须指向对应 F0xx 补齐位置。

---

## 0.1 重整后的需求清单

本清单不是新增产品愿景，而是把既有主文档、F0xx、用户截图和代码事实重新整理为可验收需求。后续 Bug 必须挂到这些需求上，不能只按标题修。

| 需求ID | 归属 | 需求 | 非目标 / 边界 | 验收标准 |
|---|---|---|---|---|
| RQ-GOV-001 | F027 | 建立需求到 Bug 的双向追踪：问题域、Bug、REQ、代码、数据、验收证据必须互相可追溯。 | 不新建平行需求文档。 | `REQ_REGISTRY.yml` 能列出问题域和关联 REQ；Bug 清单能反查到对应需求。 |
| RQ-GOV-002 | F027 | 完成标准从“有修改”改为“本地质量门禁 + 真实浏览器 + 移动端 + 线上部署 + 证据归档”。 | 不用单次截图替代验收。 | 每个修复批次都有 build/test/lint、浏览器、移动端、线上证据。 |
| RQ-CFG-001 | F000 | 配置中心按控制面治理：能力域、配置项、发布版本、消费方、错误态必须清楚。 | 不是几个 Tab 的 CRUD 集合。 | 任一配置域都能区分真实空、未授权、加载失败、未发布。 |
| RQ-AUTH-001 | F003/F011 | 登录用户必须获得稳定组织上下文，组织解析失败必须可诊断。 | 不能让业务页自行猜 org。 | 超管、管理员、普通用户、缺默认组织用户的 org/API 表现可验证。 |
| RQ-ORG-001 | F011 | 组织架构、成员、角色、销售空间必须显示真实生产数据。 | 不能在生产空态提示用户运行 seed。 | 数据库有数据时页面不得显示 0 部门 0 成员；失败显示错误态。 |
| RQ-ORG-002 | F011 | 成员新增、删除、角色分配、角色移除后，组织页与角色页同步刷新。 | 不新增第二套组织管理工作台。 | UI 操作后列表、计数、API payload 一致。 |
| RQ-EXT-001 | F011/F003 | 飞书同步必须区分未配置、无权限、上游 Unauthorized、同步成功、MVP 未覆盖成员同步。 | 不伪造外部同步成功。 | 点击同步后有明确结果、缺失配置或权限原因、同步范围说明。 |
| RQ-THEME-001 | F000 | 主题/品牌配置必须是可恢复、可发布、可消费的配置域。 | 不把品牌配置丢给静态前端变量兜底。 | 已有主题配置能显示；新增/发布后运行时 UI 可验证。 |
| RQ-RULE-001 | F009 | R001-R015 合同审核规则必须作为预置规则事实显示和管理。 | 不允许只在 migration 或 seed 中存在而配置中心不可见。 | 配置中心显示 15 条 active 规则；归档旧规则不混入 active 统计。 |
| RQ-RULE-002 | F009/F006 | 审核依据来自已发布 RuleSnapshot，并可转译为 SkillBundle。 | 不用通用 prompt 或当前表状态替代审核依据。 | ReviewRun 能追溯规则快照、SkillBundle 和测试用例。 |
| RQ-CON-001 | F005v2 | 合同中心入口语义清楚：起草、上传、风险审核、文档比对有不同前置条件和目标状态。 | 风险审核/比对不能退回上传页。 | 四个入口在无合同/有合同/已审核/多版本状态下表现明确。 |
| RQ-CON-002 | F005 | 上传合同是合同文件版本流的一环，上传后必须形成可审核 ContractVersion。 | 上传页不是合同审核终点。 | docx/pdf 上传后能触发或进入 ReviewRun 准备态。 |
| RQ-CON-003 | F005v2/F005 | 合同审核工作台按原文/批注、风险队列、销售谈判、客户反馈、输出、审计组织。 | 文本框粘贴审核不能作为主链路。 | 真实合同可进入工作台并看到 ReviewRun、RiskFinding、处理动作。 |
| RQ-CON-004 | F005/F007 | 文档比对必须有版本选择、对比结果和阻断条件。 | 没有可比版本时不能跳到上传页。 | 有可比版本时进入比对；无版本时显示前置条件。 |
| RQ-SKILL-001 | F006 | SkillBundle 是规则、模板、知识、输出 schema、模型策略的版本化运行包。 | 不把 `lib/rules` 当前执行结果直接当 Skill。 | 同一合同版本 + 同一 SkillBundle 可复现审核依据。 |
| RQ-MODEL-001 | F012 | 本地模型、云端模型、规则兜底由配置中心发布 ModelPolicy 控制。 | 不在业务代码写死模型策略。 | 模型不可用时降级原因可见，并写入 ModelInvocation 审计。 |
| RQ-WORD-001 | F007 | 批注为主、报告为辅：批注必须绑定 RiskFinding，输出为新合同版本。 | 报告不能替代 Word 原生批注伪完成。 | docx 样本可下载并在 Word/WPS 中看到原生批注；失败显示降级原因。 |
| RQ-ERR-001 | F027 | 错误态、空态、loading、404、error boundary 统一，不把失败当空数据。 | 不用 alert 或静默 catch 处理核心路径。 | 401/403/500/网络失败分别有可读提示和恢复路径。 |
| RQ-QA-001 | F027 | 验收矩阵覆盖桌面、移动端、角色矩阵、线上域名和关键 API。 | 不允许只跑单账号、单视口、单路径。 | 验收清单中每个 P0/P1 Bug 都有可复测步骤。 |
| RQ-NOISE-001 | F027/F021 | 本地依赖、构建产物、截图、trace、临时文档必须有保留/忽略/归档/删除结论。 | 不把排查产物长期堆在 truth 文档旁。 | tracked、ignored、Vercel 上传边界清楚；清理前有审批。 |

---

## 0.2 Bug 修复清单（重开第一版）

本清单按问题域和验收风险排序。状态含义：

- `待验证`：已有现象或代码事实，但还需补浏览器/API/数据库证据。
- `已确认`：截图、代码或数据事实已经足以确认。
- `待设计补齐`：不能直接修代码，必须先补齐对象/API/验收口径。

| Bug ID | 问题域 | 关联需求 | 问题 | 当前证据 | 修复方向 | 验收标准 | 状态 |
|---|---|---|---|---|---|---|---|
| BUG-P0-001 | PD02 | RQ-AUTH-001/RQ-ORG-001 | 生产有组织数据但组织架构页显示 0 部门 0 成员。 | 用户截图；前期 DB 抽查显示部门/成员存在。 | 统一 org context；API 失败不得渲染为 0。 | 同账号打开组织页显示真实部门/成员；失败时显示错误原因。 | 本地已验证，待线上复验 |
| BUG-P0-002 | PD02 | RQ-ORG-001/RQ-ERR-001 | 组织页生产空态提示运行 `node scripts/seed-via-api.mjs`。 | 用户截图。 | 空态按环境和错误类型分流。 | 生产环境不再出现 seed 指令，除非明确初始化模式。 | 本地已修复验证，待线上复验 |
| BUG-P0-003 | PD08 | RQ-EXT-001 | 飞书同步显示 Unauthorized，且没有后续动作/诊断。 | 用户截图。 | 区分登录权限、Feishu 配置、上游 Unauthorized、MVP 范围。 | 点击同步返回明确原因、建议和同步结果统计。 | 本地已验证未配置反馈；真实上游同步待凭据/线上复验 |
| BUG-P0-004 | PD03 | RQ-ORG-002 | 角色权限页角色总数 0，角色列表空。 | 用户截图；生产应有角色。 | 角色 API/前端错误态分离，不能吞错为空。 | 角色页显示真实角色或明确错误。 | 本地已验证，待线上复验 |
| BUG-P0-005 | PD03 | RQ-THEME-001 | 主题/品牌配置消失，无法判断重新配置是否可恢复。 | 用户截图；旧默认主题、metadata 和表单占位仍残留 Cyanlog。 | 恢复主题配置读取、发布、默认回退、表单编辑和运行时消费验证。 | 主题列表显示已发布配置；品牌/标题/副标题可见且可编辑；导航、浏览器标题和 favicon 不回退旧品牌。 | 本地生产浏览器桌面/390px 已验证，待线上复验 |
| BUG-P0-006 | PD03 | RQ-RULE-001 | 合同审核规则显示 0，R001-R015 不可见。 | 用户截图；生产应有预置规则。 | 规则 API 和前端错误态分离；active/archived 统计一致。 | 配置中心显示 R001-R015 active 规则。 | 本地已验证，待线上复验 |
| BUG-P0-007 | PD04 | RQ-CON-001 | 合同中心“风险审核”入口和上传/新建混同。 | 代码事实：风险审核 href 指向 `/contracts/new`。 | 入口改为审核准备态或合同选择态。 | 点击风险审核不进入上传页；无合同时显示前置条件。 | 本地已验证，待线上复验 |
| BUG-P0-008 | PD04 | RQ-CON-001/RQ-CON-004 | 文档比对无可比合同时退回 `/contracts/new`。 | 代码事实。 | 建立比对选择/阻断页。 | 无版本时提示需选择两版；有版本时进入比对。 | 本地已验证：选择页、缺文本阻断、POST 成功差异结果、超时/解析失败边界；待线上复验 |
| BUG-P0-009 | PD04 | RQ-CON-001 | 上传合同、风险审核、文档比对打开后看起来一样。 | 用户截图和代码入口事实；本地生产浏览器显示桌面入口已分流。 | 拆分入口文案、目标路由和状态机。 | 三个入口首屏目的、前置条件、操作按钮不同。 | 本地生产浏览器已验证桌面/手机入口分流；待线上复验 |
| BUG-P0-010 | PD02 | RQ-ERR-001 | 合同列表 API 失败可能显示为暂无合同记录。 | 代码审查事实。 | 合同列表区分真实空、未授权、加载失败。 | 断网/401/500 不显示“暂无合同记录”。 | 本地代码已修复；故障注入/线上复验待补 |
| BUG-P0-011 | PD05 | RQ-CON-003/RQ-SKILL-001 | ReviewRun/SkillBundle/ModelPolicy 目前多为合成字段，不是真实对象闭环。 | 代码审查事实；当前批次已用 `contract_rules_v2`、`contract_rule_snapshots`、`contract_analysis_jobs` 建立 ReviewRun 证据适配层。 | 继续补真实 SkillBundle/ModelPolicy 对象；第一阶段适配层必须显式标注证据状态和能力边界。 | 审核详情可追溯真实快照和运行包。 | 本地已验证证据适配层；完整 SkillBundle/ModelPolicy 仍待补齐 |
| BUG-P0-012 | PD06 | RQ-RULE-002/RQ-SKILL-001 | 审核规则尚未真正从配置中心发布后转译为 SkillBundle。 | 代码审查事实。 | F009 发布 -> F006 编译 -> F005 绑定。 | 新旧规则发布后 ReviewRun 不漂移。 | 待设计补齐 |
| BUG-P0-013 | PD06 | RQ-MODEL-001 | 大模型/本地模型调用策略没有证明由 F012 ModelPolicy 控制。 | 代码审查事实。 | 运行时消费已发布 ModelPolicy，记录 ModelInvocation。 | 模型不可用时显示降级链和审计记录。 | 待设计补齐 |
| BUG-P0-014 | PD07 | RQ-WORD-001 | Word 批注导出资产存在，但缺少产品级 CommentPatch/降级/下载验收。 | 代码审查事实；当前批次已抽出 `RiskFinding -> CommentPatch -> contract_annotations` 适配层，分析保存和导出接口复用同一转换逻辑，并补充 docx zip 级原生批注测试。 | 继续补下载样本、Word/WPS 打开验收和降级状态可视化。 | docx 样本可下载、打开、看到批注；失败有降级原因。 | 本地已验证适配层、原生批注 zip 结构和构建；Word/WPS 人工验收待补 |
| BUG-P1-015 | PD02 | RQ-AUTH-001 | admin/org 与其他 API 的默认组织解析可能不一致。 | 代码审查事实。 | 统一 `getDefaultOrgId` 或单一 org resolver。 | 缺默认 membership 用户不再导致配置中心假空。 | 已确认 |
| BUG-P1-016 | PD03 | RQ-ORG-002 | 管理员新增成员后没有刷新或显示仍是固定内容。 | 用户反馈。 | 写接口成功后失效组织/角色缓存并重拉。 | 新增成员后组织页和角色页立即可见。 | 本地生产浏览器已验证新增/移除后刷新；待线上复验 |
| BUG-P1-017 | PD03 | RQ-ORG-002 | 超管布局中无法增加或删减人。 | 用户反馈截图。 | 明确超管权限设置只读与员工分配可编辑边界。 | 超管角色员工分配可新增/移除，权限设置按设计只读。 | 本地生产浏览器已验证角色成员新增/移除；待线上复验 |
| BUG-P1-018 | PD08 | RQ-EXT-001 | 外部组织架构没有真正引入，点击同步后无闭环。 | 用户反馈。 | Feishu sync 显示同步范围、统计、失败原因；必要时补成员同步需求边界。 | 同步后显示新增/更新/跳过统计；未支持能力明确说明。 | 本地已验证未配置/范围反馈；真实导入待凭据 |
| BUG-P1-019 | PD03 | RQ-CFG-001 | 配置中心 `!res.ok` 多处静默返回，导致 API 错误被渲染为空。 | 代码审查事实。 | 统一 API envelope 和错误态。 | 任一配置 API 401/403/500 都显示错误态。 | 本地代码已修复；故障注入待补 |
| BUG-P1-020 | PD05 | RQ-CON-002 | 合同上传是否形成可审核 ContractVersion 尚未验收。 | 用户反馈“上传合同是什么”；本地生产浏览器已完成真实 DOCX 上传和版本表核验。 | 明确上传在合同版本流中的位置。 | 上传后合同详情显示源文件版本，可触发审核。 | 本地生产浏览器/API 已验证：上传 -> merge -> submit -> analyze -> review，contract_versions 写入 version 1；待线上复验 |
| BUG-P1-021 | PD05 | RQ-CON-003 | 风险审核工作台仍偏低产品化，不能代表“批注为主、报告为辅”的商业产品。 | 用户反馈和截图。 | 按 F005v2 工作台重新组织信息架构。 | 首屏有原文/批注、风险、谈判、输出、审计区域。 | 待设计补齐 |
| BUG-P1-022 | PD05 | RQ-CON-003 | 必须谈判的风险项没有 NegotiationTask 生命周期。 | 代码审查事实；当前批次确认复用 `ask_items` 作为谈判任务对象，并让 review API 优先读取真实 ASK，缺失时才按风险卡 fallback；2026-07-01 追加验证 ASK 回应后会生成 `report_versions` 升版快照。 | 继续补真实 ASK 生成、回应、关闭、再审核的端到端验收。 | 风险状态可从发现流转到谈判/客户反馈/再审核。 | 本地已验证 ASK 读取/fallback/回应报告升版单测；真实可重置样本与再审核待补 |
| BUG-P1-023 | PD05 | RQ-CON-003 | CustomerFeedback 对象缺失，客户接受/拒绝/反建议闭环未落地。 | 代码审查事实；当前批次确认复用 `ask_responses` 作为第一阶段业务/客户反馈承载，并在谈判任务卡片展示回应；回应提交后会写入当前报告版本快照。 | 继续补客户接受/拒绝/反建议语义、再审核触发和批注/报告文件升版。 | 客户反馈能改变风险项状态或生成再审核任务。 | 本地已验证 response 映射和 report_versions 升版；真实反馈状态机待补 |
| BUG-P1-024 | PD04 | RQ-CON-004 | 文档比对 GET/API/UI 闭环需要重新验收。 | 历史问题清单 + 当前入口混乱；本地生产浏览器显示同业务关系结果页非空，污染结果被阻断。 | 对比入口、API、结果页一体修复。 | 选择两版合同后返回差异结果，失败可解释。 | 本地生产浏览器已验证结果页/阻断态；线上复验待补；比对数据污染另记 BUG-P1-047 |
| BUG-P1-025 | PD05 | RQ-CON-003 | `/contracts/[id]/page` 与 `/contracts/[id]/review/page` 存在并行审核页面风险。 | 代码审查事实；旧 `/review` 路由已改为重定向主工作台，上传完成和提交 API 返回主工作台 URL；本地生产浏览器已验证登录态访问旧 URL 自动落到主工作台。 | 以 `/contracts/[id]` 作为唯一审核工作台；旧页资产仅保留在组件层待 G11 噪音治理复核。 | 合同详情和审核页不再表达两套不同产品逻辑；访问 `/contracts/{id}/review` 自动进入 `/contracts/{id}`。 | 本地生产浏览器已验证，待线上复验 |
| BUG-P1-026 | PD03 | RQ-RULE-001 | 主文档第6章 API 路径和 MVP 勾选状态可能落后于实现/现状。 | 文档审查事实。 | 更新主文档配置中心章节。 | 文档 API、状态、F000/F009/F011/F012 一致。 | 已确认 |
| BUG-P1-027 | PD01 | RQ-GOV-001 | `REQ_REGISTRY.yml` 状态与线上事实不完全一致，例如 F003 completed 需复核。 | 文档审查事实。 | 增加 caveat 后统一复核状态。 | 每个 completed 都有当前线上证据或降级状态。 | 已确认 |
| BUG-P1-028 | PD09 | RQ-QA-001 | E2E README 写 `pnpm test:e2e`，但 package scripts 没有该命令。 | 代码/文档审查事实；当前批次已补 `test:e2e` / `test:e2e:headed` / `test:e2e:install`。 | 补脚本或修 README。 | README 命令可直接运行。 | 本地已验证脚本可列出 8 条 E2E；全量 E2E 仍待独立运行 |
| BUG-P1-029 | PD09 | RQ-QA-001 | E2E README 凭证与 `critical-path.spec.ts` 凭证不一致。 | 代码/文档审查事实；当前批次已统一为 `e2e-admin@huarun.com / E2ETestPassword123!`。 | 统一测试凭证说明。 | 文档与 spec 一致。 | 本地已修复，待线上/CI 验收 |
| BUG-P1-030 | PD09 | RQ-QA-001 | E2E 覆盖不足，缺少配置中心假空态、合同入口、移动端、角色矩阵。 | 测试审查事实。 | 建立 P0/P1 验收矩阵。 | 每个 P0 Bug 有自动或手动可复测步骤。 | 已确认 |
| BUG-P2-031 | PD02 | RQ-ERR-001 | 错误页返回首页性能和预热策略需要按异常路径验收。 | 用户反馈。 | error boundary 下减少争抢网络，验证返回首页耗时。 | 错误页返回首页不出现长等待或重复错误。 | 待验证 |
| BUG-P2-032 | PD09 | RQ-QA-001 | 移动端/iPad 真实验收不足。 | 用户反馈。 | 桌面、iPad、手机三视口纳入门禁。 | 核心页无横向溢出、遮挡、按钮不可点。 | 本地已验证合同中心手机视口、配置中心 iPad 视口 |
| BUG-P2-033 | PD10 | RQ-NOISE-001 | output、trace、截图等本地证据噪音多，缺少保留/清理策略。 | 工作区存在 `.vercel/output`、`product-code/.vercel/output`、`product-code/output`、`playwright-report`、`test-results`；当前未被 Git 跟踪。根 `.vercelignore` 和 `product-code/.vercelignore` 已排除 output、trace、har、playwright 报告和 test-results。 | 继续统一 ignored 证据目录和 manifest；需要保留的证据只写入 F027/manifests，不把原始产物提交。 | 临时产物不入 Git、不上传 Vercel；保留理由明确。 | 已确认，待 manifest 收口 |
| BUG-P2-034 | PD10 | RQ-NOISE-001 | tracked `.DS_Store` 等非代码噪音需清理。 | `git ls-files` 显示 `.DS_Store`、`docs-governance/maintenance-config-维护配置/.DS_Store`、`governance/runtime-config-AI运行配置/.DS_Store` 已被跟踪。 | 删除前列清单审批；批准后从 Git 索引移除并依赖 `.gitignore`/`.vercelignore` 阻断复发。 | 清理后 git 不再跟踪无价值系统文件。 | 待确认删除 |
| BUG-P2-035 | PD10 | RQ-NOISE-001 | 外部依赖是否导致上传/构建性能下降需要证据化，而不是笼统删除。 | 用户反馈 + 当前审查显示依赖锁文件为根 `pnpm-lock.yaml`、`product-code/pnpm-lock.yaml` 和治理脚本 `package-lock.json`；`node_modules`、`.next`、`.vercel` 已被 Git/Vercel 忽略。 | 区分 direct/transitive、runtime/dev、tracked/ignored、Vercel payload；依赖结论必须基于 package/lock/source 引用，而不是按“外部依赖”整体删除。 | 给出依赖保留/移除/移动到 devDependencies 结论。 | 初步边界已确认，待依赖必要性审计 |
| BUG-P2-036 | PD09 | RQ-QA-001 | DropdownMenu 曾被 overflow 容器裁剪，人员菜单点击无响应。 | 用户原始 A4/B10/E8 反馈。 | 保留 Portal 修复并纳入组织权限回归。 | 人员列表菜单在桌面/iPad/移动端可点击且不被裁剪。 | 历史已修复，待回归固化 |
| BUG-P2-037 | PD03 | RQ-THEME-001 | favicon/浏览器图标未生效或质量未知。 | 用户原始 A6/B8/C2 反馈。 | 将 favicon 作为界面主题/品牌资产验收项。 | 本地和线上浏览器标签显示正确图标，非 Vercel 默认。 | 待线上复验 |
| BUG-P2-038 | PD03 | RQ-THEME-001 | 主题布局中 Logo/图标卡片图片溢出。 | 用户原始 A7 反馈。 | 主题图片上传、预览、裁剪和容器尺寸统一。 | 上传/预览 Logo 和图标时不溢出、不遮挡。 | 待回归 |
| BUG-P1-039 | PD09 | RQ-QA-001 | 知识库新建按钮 404 或无法点击。 | 用户原始 B5/B6 反馈；当前构建清单包含 `/knowledge/new`。 | 明确 F015-F017 知识库入口状态，修复路由/按钮/空态。 | 点击新建进入可用创建页；未实现能力显示受控占位而非 404。 | 本地生产浏览器桌面/390px 已验证；待线上复验 |
| BUG-P1-040 | PD05 | RQ-CON-002/RQ-ERR-001 | 合同上传链路 FormData/JSON、错误格式、进度、拖拽、并发控制未闭环。 | 用户原始 A8/E1-E6/C5 反馈；本地生产浏览器显示上传页含拖拽、500MB、断点续传、3 并发说明，并跑通真实 DOCX 上传。 | 上传作为 ContractVersion 创建流处理，API envelope 和前端状态一致。 | docx/pdf 上传有进度、错误可读、并发受控，成功后形成可审核版本。 | 本地生产浏览器/API 已验证真实 DOCX 上传、进度、分块合并、审核页跳转；待线上复验 |
| BUG-P2-041 | PD04 | RQ-CON-001/RQ-QA-001 | 合同中心 QuickAction、合同卡片点击区域、分页加载和移动端反馈不清晰。 | 用户原始 B12/E3/E9/E10 反馈；本地生产手机宽度显示底部起草/上传/审核/比对入口。 | 合同中心列表和快捷入口统一信息架构与交互反馈。 | 合同多页数据可加载；卡片/按钮点击目标明确；移动端有反馈。 | 上传 QuickAction 已改主上传页；桌面/手机入口可点；分页待回归 |
| BUG-P2-042 | PD09 | RQ-ERR-001/RQ-QA-001 | alert/toast 混用、空 catch、`// ignore`、角色硬编码、API 缺 Zod 校验、console/any 残留。 | 用户原始 B13-B17/B19/B20/E7 反馈。 | 作为代码质量治理批次，不与业务修复混合关闭。 | 核心 API 有 schema；用户态错误用 toast/错误态；无无意义 console/any/空 catch。 | 待审计 |
| BUG-P2-043 | PD09 | RQ-ERR-001 | 404 页面、loading 状态、空状态设计不统一。 | 用户原始 B21-B23 反馈。 | 建立统一 error/loading/empty 组件和路由级验收。 | 404、加载失败、真实空、未授权四类状态可区分且样式一致。 | 待验证 |
| BUG-P2-044 | PD09 | RQ-QA-001/RQ-GOV-002 | Harness test 失败、`--no-verify` 绕过和治理项未收敛。 | 用户原始 D5-D9 反馈。 | 恢复测试命令、提交门禁和发布证据链。 | 不依赖 `--no-verify`；失败测试有修复或明确豁免记录。 | 待验证 |
| BUG-P2-045 | PD09 | RQ-QA-001 | 新增 lint 错误和 warning 清理不完整。 | 用户原始 F1-F10/C6 反馈。 | 固化 lint/typecheck/test 回归，不把 warning 当完成。 | `pnpm lint`、`pnpm exec tsc --noEmit`、目标测试和全量测试通过；剩余 warning 有归属。 | 本地当前批次通过，待发布门禁 |
| BUG-P2-046 | PD03 | RQ-CFG-001 | 配置中心菜单重复。 | 用户原始 G1 反馈。 | 配置域导航源收敛，避免重复注册。 | 配置中心菜单无重复项；新增配置域需走同一 registry。 | 历史已修复，待回归固化 |
| BUG-P1-047 | PD04/PD10 | RQ-CON-004/RQ-NOISE-001 | 文档比对结果混入 Hemory 条款，说明合同测试/历史数据存在跨产品污染风险。 | 本地生产浏览器打开 `/contracts/c0319a20-eec1-493f-8ea1-bbd1b408a4f8/compare` 曾出现 Hemory 条款；API 元数据确认 Hemory 记录缺少同客户/同报价关系。 | 候选和 POST/GET 均按同报价、同客户或 legacy 同上传者关系过滤；后续仍需清理或隔离跨产品样本数据。 | 合同中心列表、比对候选和结果页不得默认展示跨产品/无关业务合同；测试样本必须可追溯来源和用途。 | 本地生产浏览器/API 已验证污染比对被阻断；样本清理与线上复验待补 |

### 0.2.1 Bug 到子目标映射

这张表用于避免后续修复再次退回“按单个标题修”。同一个 Bug 可以服务多个子目标，但主归属只能有一个。

| 子目标 | 主归属 Bug | 说明 |
|---|---|---|
| G1 需求与问题资产治理 | BUG-P1-027 / BUG-P1-028 / BUG-P1-029 / BUG-P1-030 | 需求状态、E2E 文档、测试命令和验收矩阵属于治理层问题，修复后要反哺清单。 |
| G2 合同审核产品闭环 | BUG-P0-011 / BUG-P0-014 / BUG-P1-020 / BUG-P1-021 / BUG-P1-022 / BUG-P1-023 / BUG-P1-025 | 这些问题不能靠页面小改完成，必须落到 ContractVersion、ReviewRun、RiskFinding、NegotiationTask、CustomerFeedback、CommentPatch 和输出物。 |
| G3 审核规则与 Skill 闭环 | BUG-P0-006 / BUG-P0-012 / BUG-P0-013 | R001-R015 可见只是表层，最终验收要证明 RuleSnapshot、SkillBundle、ModelPolicy 能被 ReviewRun 绑定。 |
| G4 配置中心数据底座 | BUG-P0-004 / BUG-P0-005 / BUG-P0-006 / BUG-P1-019 / BUG-P1-026 / BUG-P2-037 / BUG-P2-038 / BUG-P2-046 | 配置中心不能再把加载失败、权限失败、未发布和真实空混成同一种 0 数据。 |
| G5 组织权限与外部同步 | BUG-P0-001 / BUG-P0-002 / BUG-P0-003 / BUG-P1-015 / BUG-P1-016 / BUG-P1-017 / BUG-P1-018 | 组织、角色、成员、超管、管理员和飞书同步必须共用同一组织上下文与错误诊断。 |
| G6 合同中心信息架构 | BUG-P0-007 / BUG-P0-008 / BUG-P0-009 / BUG-P1-020 / BUG-P1-024 / BUG-P1-040 / BUG-P2-041 / BUG-P1-047 | 起草、上传、风险审核、文档比对四个入口必须按前置条件和业务结果拆开，且默认样本不能污染业务语境。 |
| G7 API 与数据一致性 | BUG-P0-010 / BUG-P1-015 / BUG-P1-019 / BUG-P1-024 / BUG-P1-040 / BUG-P2-042 / BUG-P2-043 / BUG-P1-047 | API 错误、组织解析、合同比对和配置读取需要用一致 envelope、schema、权限和数据证据验收。 |
| G8 前端体验与响应式 | BUG-P2-031 / BUG-P2-032 / BUG-P2-036 / BUG-P2-038 / BUG-P2-041 / BUG-P2-043 | 异常页返回、移动端、iPad 和核心操作反馈必须进入真实浏览器验收。 |
| G9 性能与稳定性 | BUG-P2-031 / BUG-P2-035 | 性能问题按冷登录、异常路径、配置中心首入、外部依赖等待和部署上传体积量化。 |
| G10 发布与验收治理 | BUG-P1-028 / BUG-P1-029 / BUG-P1-030 / BUG-P2-032 / BUG-P1-039 / BUG-P2-044 / BUG-P2-045 | 完成证据必须覆盖命令、测试、浏览器、移动端和线上域名。 |
| G11 文档与噪音治理 | BUG-P2-033 / BUG-P2-034 / BUG-P2-035 / BUG-P1-047 | 清理前必须先判断产品价值、复用价值、归档位置和删除风险；跨产品样本不得混入默认业务数据。 |

当前重开 Bug 清单数量为 47 条；它不是最终问题总量，只是已结构化登记的第一批。后续新发现问题必须先归到 G1-G11 和 PD01-PD10，再决定是否新增 Bug、合并 Bug 或更新已有 Bug 状态。

### 0.2.2 按目标推进的执行批次

本表是后续开发与验收入口。批次可以并行排查，但不得跳过前置验收来声明完成。

| 批次 | 主目标 | 覆盖 Bug | 主要产物 | 批次完成信号 |
|---|---|---|---|---|
| B0 需求/问题资产归位 | G1 / G11 | BUG-P1-027 / BUG-P2-033 / BUG-P2-034 / BUG-P2-035 | 主文档索引、REQ 注册、F027 Bug 清单、噪音处理结论 | 所有 P0/P1 Bug 都能反查目标、REQ、问题域、验收标准和证据位置。 |
| B1 配置与组织假空态 | G4 / G5 / G7 / G8 | BUG-P0-001 至 BUG-P0-006、BUG-P1-015 至 BUG-P1-019 | 组织/角色/主题/规则读取、错误态、飞书同步诊断 | 线上同账号看到真实组织、角色、主题、R001-R015；失败时不是 0 数据。 |
| B2 合同中心入口与上传/比对 | G6 / G7 / G8 / G10 / G11 | BUG-P0-007 至 BUG-P0-010、BUG-P1-020、BUG-P1-024、BUG-P1-040、BUG-P1-047、BUG-P2-041 | 起草/上传/审核/比对入口分流、ContractVersion 上传、比对 API/UI、合同列表反馈、测试数据隔离 | 桌面和移动端真实浏览器能跑通上传、进入可审核状态、版本比对和错误阻断态；默认比对数据不混入跨产品噪音。 |
| B3 合同审核商业对象闭环 | G2 / G3 / G7 | BUG-P0-011 至 BUG-P0-014、BUG-P1-021 至 BUG-P1-025 | ReviewRun、RiskFinding、NegotiationTask、CustomerFeedback、CommentPatch、AnnotatedDocument/Report | 真实合同能从审核运行到风险处理、谈判、批注输出、报告归档，且可追溯规则/Skill/模型。 |
| B4 体验、性能和质量债 | G8 / G9 / G10 | BUG-P2-031 / BUG-P2-032 / BUG-P2-036 至 BUG-P2-045、BUG-P1-039 | 移动端/iPad 验收、404/loading/empty、知识库入口、lint/test/build、登录/配置性能证据 | 核心路径通过桌面、iPad、手机；质量命令通过；性能指标有 trace 或 header 证据。 |
| B5 发布与收尾 | G10 / G11 | 所有未线上验证项 | Vercel Ready/Production、线上 smoke、release evidence、噪音归档/删除确认 | 主域名线上验收通过；临时文档、截图、trace、输出物都有保留/归档/删除结论。 |

### 0.2.2.1 当前执行看板（2026-07-01 接续）

本看板用于判断“继续工作”时下一步应该做什么。它不替代 Bug 清单，而是把 B0-B5 批次的当前证据、缺口和完成口径放在同一处，避免再次把“已修改”“本地通过”“线上可验收”混为一谈。

| 批次 | 当前状态 | 已有证据 | 未闭环缺口 | 下一步出口 |
|---|---|---|---|---|
| B0 需求/问题资产归位 | 修复中 | 主文档 0.4、F027 0.0-0.2、`REQ_REGISTRY.yml#audit_supplement` 已建立 G0/G1-G11、PD01-PD10、47 条结构化 Bug 和用户原始 A-G 映射。 | 后半段历史 D01-D10/P0-P4 记录仍可能干扰当前 G/PD/Bug 体系；F027 evidence manifest 与当前 dirty worktree、最新未部署改动尚未完全同步。 | 当前 truth 以 0.x 段、`REQ_REGISTRY.yml` 和本看板为准；历史段只作证据来源，不得反向覆盖当前状态。 |
| B1 配置与组织假空态 | 本地已验证，待线上复验 | 组织、角色、主题、R001-R015 规则、本地浏览器和部分历史线上样本已有证据。 | 当前工作树仍有未部署改动，用户最新截图暴露过线上假空态；Feishu 真实凭据和上游成功导入未验收。 | 先保证当前代码质量门禁通过，再线上复验组织/角色/主题/规则/Feishu 未配置态。 |
| B2 合同中心入口与上传/比对 | 本地已验证，待线上复验 | 上传入口、ContractVersion、文档比对阻断/成功、污染候选过滤已有本地 API/浏览器证据。 | 当前线上是否已包含最新入口/比对修复未确认；测试样本隔离和默认数据污染仍需收尾。 | 用同一线上账号复验 `/contracts` 四入口、真实上传、比对候选和结果页。 |
| B3 合同审核商业对象闭环 | 本地已验证，待线上复验 | 已补 ReviewRun 证据适配层、CommentPatch 适配层、ASK-backed NegotiationTask/CustomerFeedback 映射、ASK 回应后 `report_versions` 升版快照、Word docx zip 级测试；2026-07-01 已补真实 `contract_skill_bundles`、`model_policies`、`model_invocations` 和 `POST /api/contracts/:id/review-runs` 再审核触发；本地 production 临时样本跑通 `上传 -> 初审 -> 再审核 -> review evidence -> Word 批注导出 -> ContractVersion v2/report_version 关联 -> Storage/DB 清理`。 | 线上 Production 未复验；WPS 未安装，当前只完成人工 Word 打开验收；完整 Skill 编辑/模拟/发布控制台、模型连接健康检查、客户反馈驱动再审核状态机仍是后续项。 | 下一优先级是当前提交推送、Vercel Production 构建和主域在线复验，不再用本地样本替代线上证据。 |
| B4 体验、性能和质量债 | 修复中 | 多批次 lint/typecheck/test/build、移动端/iPad、登录 timing、配置拆包、错误边界证据已记录；当前批次已重跑 B3 定向测试、全量 `pnpm test:run`、`tsc --noEmit`、`pnpm lint`、`pnpm build`；导出链路已拆分 `review_data_load / clauses_load / annotations_load / risk_patches_load / storage_download / docx_generate / storage_upload / version_register / report_version_link`。 | 错误/空/loading/404 统一和 console/any/alert 审计没有完成全域关闭；冷登录 RPC 已有 900ms 截止，后续 fallback 外部 I/O 已补 transport deadline，但仍需线上样本证明没有 40s+ 长尾。 | 每个业务批次结束都重跑质量门禁和真实浏览器，不把历史通过当当前通过。 |
| B5 发布与收尾 | 待执行 | 历史 manifest 记录过 Production `dpl_3SY9pJkSKsyN7m5jYzbTwcXSjGM5`、主域和 payload 边界；本批次 Supabase 迁移已应用到远端。 | 当前改动尚未提交/推送/部署；线上验收不能复用旧部署证明；噪音删除项仍需用户确认。 | 只有当前批次代码合并、推送、Vercel Ready/Production、线上 smoke 和噪音收尾都完成后，才允许进入“收尾完成”。 |

状态判定规则：

- `本地已验证` 只说明当前本地代码和本地数据样本成立，不能证明线上完成。
- `线上已验证` 必须指向当前部署版本、主域路径、账号、视口/API 和可复测结果。
- `收尾完成` 必须同时满足功能验收、文档回写、证据归档和噪音处理结论。
- 历史线上证据可以作为参考，但当前工作树有未部署业务改动时，不得用历史部署证明当前目标完成。

### 0.2.3 用户原始 A-G 清单归并映射

本表保留用户原始编号，避免“合并后看不见原问题”。合并依据不是标题相似，而是同一业务对象、同一接口/状态机、同一验收证据。

| 原始编号 | 原始问题摘要 | 归并 Bug | 主目标归属 | 归并依据与当前处理 |
|---|---|---|---|---|
| A1 | 移动端布局异常 | BUG-P2-032 / BUG-P2-036 | G8/G10 | 与 iPad/移动端导航、按钮可点、菜单裁剪同属响应式验收。 |
| A2 | 合同审核规则未预置 | BUG-P0-006 / BUG-P0-012 | G3/G4 | 预置规则可见性和发布为 SkillBundle 是同一规则闭环。 |
| A3 | 组织架构布局异常且数据消失 | BUG-P0-001 / BUG-P1-015 | G5/G7 | 表格布局只是表象，根因按组织上下文、API 错误态和数据读取验收。 |
| A4 | 员工操作菜单无法点击 | BUG-P2-036 | G8 | Portal/overflow 已作为历史修复项纳入回归。 |
| A5 | 超管添加人后复现老问题 | BUG-P1-016 / BUG-P1-017 | G5 | 新增/移除成员和超管员工分配共用同一角色分配状态机。 |
| A6 | favicon 未生效 | BUG-P2-037 | G4/G8 | 归入主题/品牌运行时资产验收。 |
| A7 | 主题布局错位 | BUG-P2-038 | G4/G8 | Logo/图标溢出归入主题配置 UI 和上传预览验收。 |
| A8 | 合同上传无法工作 | BUG-P1-020 / BUG-P1-040 | G2/G6/G7 | 上传必须形成 ContractVersion，并闭合 API/前端状态。 |
| A9 | 风险审核按钮无法点击 | BUG-P0-007 / BUG-P1-021 | G2/G6 | 入口路由和审核工作台产品化属于合同中心信息架构。 |
| A10 | 文档对比只剩按钮 | BUG-P0-008 / BUG-P1-024 | G6/G7 | GET/API/UI 和版本选择是文档比对闭环。 |
| B4 | iPad 导航栏汉堡按钮遮挡 | BUG-P2-032 | G8/G10 | 归入 iPad/移动端真实浏览器验收。 |
| B5 | 知识库新建按钮 404 | BUG-P1-039 | G10 | 知识库入口要么可用，要么受控占位，不能 404。 |
| B6 | 知识库新建按钮无法点击 | BUG-P1-039 | G10 | 与 B5 同一按钮/路由验收。 |
| B7 | 审核规则表无预置数据 | BUG-P0-006 / BUG-P0-012 | G3/G4 | 与 A2 同根因。 |
| B8 | favicon 浏览器未显示 | BUG-P2-037 | G4/G8 | 与 A6 同根因。 |
| B9 | 超管消失 Bug | BUG-P0-001 / BUG-P0-004 / BUG-P1-015 | G5/G7 | 组织/角色假空态和默认组织解析共同验收。 |
| B10 | 人员列表菜单点击无响应 | BUG-P2-036 | G8 | 与 A4 同根因。 |
| B11 | 组织与权限两套代码重复 | BUG-P1-015 / BUG-P1-025 | G5/G7 | 归入组织聚合接口和并行工作台治理。 |
| B12 | 合同中心 QuickAction 重复跳转 | BUG-P0-007 / BUG-P0-008 / BUG-P2-041 | G6 | 入口状态机和点击目标统一验收。 |
| B13 | 错误处理 `// ignore` | BUG-P2-042 | G7/G10 | 归入代码质量与错误治理。 |
| B14 | 空 catch 块 | BUG-P2-042 | G7/G10 | 与 B13 同类治理。 |
| B15 | alert() 滥用 | BUG-P2-042 | G8/G10 | 用户反馈方式统一为 toast/错误态。 |
| B16 | 权限 TODO 角色硬编码 | BUG-P2-042 | G5/G7 | 权限边界必须由 F011/F003 消费，不硬编码。 |
| B17 | API 无 Zod 参数校验 | BUG-P2-042 | G7/G10 | 核心 API schema 治理。 |
| B18 | window.location.reload 暴力刷新 | 无活动 Bug | G8 | 原清单标为不存在；保留为回归搜索项，不登记为当前缺陷。 |
| B19 | console.log 性能日志残留 | BUG-P2-042 / BUG-P2-045 | G9/G10 | 日志残留按 lint/性能噪声治理。 |
| B20 | 类型 any 滥用 | BUG-P2-042 / BUG-P2-045 | G7/G10 | 类型债务按代码质量治理。 |
| B21 | 404 页面缺失处理 | BUG-P2-043 | G8/G10 | 归入统一错误/404。 |
| B22 | loading 状态不一致 | BUG-P2-043 | G8/G10 | 归入统一 loading。 |
| B23 | 空状态设计不统一 | BUG-P2-043 | G8/G10 | 归入真实空/错误空区分。 |
| C1 | 新增错误 compare 页面 | BUG-P1-024 / BUG-P2-045 | G6/G10 | 历史错误页面已删除，但保留在比对和 lint 回归。 |
| C2 | favicon.png 质量未知 | BUG-P2-037 | G4/G8 | 与 A6/B8 同根因。 |
| C3 | migration 可能插入失败 | BUG-P0-006 / BUG-P0-012 | G3/G7 | 规则 seed/migration 与规则快照闭环共同验收。 |
| C4 | Ponytail 文档追加 | BUG-P2-033 / BUG-P2-034 | G11 | 作为噪音/临时文档治理。 |
| C5 | 合同 POST API 改多次不稳定 | BUG-P1-040 / BUG-P2-042 | G7/G10 | 上传/合同 API envelope 和测试门禁一起验收。 |
| C6 | ESLint 清理改多个文件 | BUG-P2-045 | G10 | 历史清理保留为 lint 回归证据。 |
| C7 | 对比按钮 href 指向问题 | BUG-P0-008 / BUG-P1-024 | G6/G7 | 与 A10 同根因。 |
| C8 | 风险审核 href 指向问题 | BUG-P0-007 / BUG-P1-021 | G2/G6 | 与 A9 同根因。 |
| D5 | test 失败未修复 | BUG-P2-044 / BUG-P2-045 | G10 | 归入发布和测试门禁治理。 |
| D6 | 使用 `--no-verify` 绕过 | BUG-P2-044 | G10/G11 | 归入提交治理和证据链。 |
| D7-D9 | 其他 Harness 治理问题 | BUG-P2-044 | G10/G11 | 原清单未拆标题，先挂 Harness 治理，后续按证据拆分。 |
| E1 | 合同 POST 期望 JSON 但上传发 FormData | BUG-P1-040 | G6/G7 | 上传 API 合同和前端请求格式统一。 |
| E2 | 上传 API 错误响应格式不一致 | BUG-P1-040 / BUG-P2-042 | G7 | 错误 envelope 统一。 |
| E3 | 合同列表无分页加载 | BUG-P2-041 | G6/G9 | 合同列表规模和性能体验共同验收。 |
| E4 | 无并发控制 | BUG-P1-040 | G7/G9 | 上传/审核任务并发需要状态机约束。 |
| E5 | 上传无进度条 | BUG-P1-040 | G6/G8 | 上传体验验收。 |
| E6 | 无拖拽上传反馈 | BUG-P1-040 | G6/G8 | 上传体验验收。 |
| E7 | alert/toast 混用 | BUG-P2-042 | G8/G10 | 与 B15 同根因。 |
| E8 | DropdownMenu 裁剪 | BUG-P2-036 | G8 | 与 A4/B10 同根因。 |
| E9 | 合同卡片点击区域不明确 | BUG-P2-041 | G6/G8 | 合同中心点击目标治理。 |
| E10 | 移动端按钮无反馈 | BUG-P2-032 / BUG-P2-041 | G8/G10 | 移动端真实交互验收。 |
| F1 | compare 路由语法错误 | BUG-P1-024 / BUG-P2-045 | G6/G10 | 历史已修，保留在比对与 lint 回归。 |
| F2 | analyze 路由 err 未使用 | BUG-P2-045 | G10 | 历史已修，保留在 lint 回归。 |
| F3-F10 | 8 个 Warning | BUG-P2-042 / BUG-P2-045 | G7/G10 | 原清单未拆具体 warning，先按代码质量治理挂账。 |
| G1 | 配置中心菜单重复 | BUG-P2-046 | G4/G8 | 历史已修，纳入配置导航回归。 |

---

## 0.3 2026-06-30 本地修复与验证记录

本批次只覆盖 P0 假空态、合同中心入口语义、文档比对阻断/成功/异常边界和移动端/iPad 可用性，不代表合同审核商业产品闭环完成。

代码与文档修复：

- `app/configs/ConfigsClient.tsx`：配置中心请求失败不再静默吞掉，活动 tab 未加载/失败时不再显示真实 0。
- `app/configs/tabs/OrgStructureTab.tsx`：生产空态不再提示运行 `node scripts/seed-via-api.mjs`。
- `app/contracts/page.tsx`：风险审核和文档比对入口不再退回 `/contracts/new`；合同列表加载失败显示错误态。
- `app/contracts/[id]/compare/page.tsx`：开始比对前先检查两份合同是否有解析文本或源文件；缺失时显示可恢复阻断态，不再触发 400 裸错误页。
- `app/api/contracts/[id]/compare/route.ts`：合同缺少 `parsed_text` 但存在 `storage_path` 时按需从源文件提取文本；源文件下载设置 8 秒超时；下载失败、超时、解析失败统一返回可解释 400。
- `app/api/contracts/[id]/compare/route.test.ts`：补充缺源文件、源文件读取超时、文本解析失败和成功比对的 API 回归测试。
- `REQ_REGISTRY.yml` 与本 F027：补齐问题域、需求清单、Bug 清单和状态回写。

质量门禁：

- `pnpm exec tsc --noEmit`：通过。
- `pnpm lint`：通过。
- `pnpm exec vitest run 'app/api/contracts/[id]/compare/route.test.ts' 'lib/contracts/text-extraction.test.ts'`：2 个测试文件、6 个测试通过。
- `pnpm test:run`：103 个测试文件、436 个测试通过。
- `pnpm build`：通过；`/configs` First Load JS 129 kB，`/contracts` 145 kB，`/contracts/[id]/compare` 127 kB。

真实浏览器验证：

- 桌面配置中心：组织架构显示 11 部门、25 成员、3 销售空间；角色权限显示 7 角色；合同规则显示 15 条 active 规则，R001-R015 可见；主题配置显示 1 个已发布主题。
- 桌面合同中心：风险审核入口进入合同审核工作台，不再跳上传页；文档比对入口进入 `/contracts/{id}/compare` 结果页或选择页。
- 旧合同详情：`/contracts/44301b16-6551-4720-afa5-f1d80b1604de` 不再复现错误边界，但仍缺正文和批注产物，属于合同审核产品闭环未完成。
- 文档比对 GET 结果页：`/contracts/c0319a20-eec1-493f-8ea1-bbd1b408a4f8/compare` 显示 50 条差异、双栏原文/对比文档和 AI 差异解读；浏览器 console 无错误。
- 文档比对 POST 发起页：`/contracts/13aca6c2-e902-4458-9e94-6d8db8ae7a09/compare` 点击开始比对后 API 返回 201，页面显示 20 条差异；浏览器 console 无错误。
- 文档比对阻断态：缺解析文本且缺源文件时显示“暂不能发起文档比对”，提供返回合同、补充可比对文件、重新选择；API 错误可解释。
- 手机 390x844：合同中心无主内容遮挡，底部起草/上传/审核/比对入口可见；比对结果页可打开并显示差异，console 无错误。
- iPad 820x1180：配置中心组织与角色页可见真实数据；超管添加成员弹窗可打开并显示 24 个候选人；未执行实际添加/移除，避免污染数据。
- 飞书同步：未配置环境下会先确认“本阶段不会导入成员”，确认后显示缺少 `FEISHU_APP_ID / FEISHU_APP_SECRET` 和配置指引；真实导入仍需凭据与线上验证。

剩余不能标完成的关键缺口：

- 合同审核已补 `ReviewRun`、`CommentPatch`、`NegotiationTask/CustomerFeedback` 的第一阶段适配层，但仍缺真实 `ASK 生成 -> ASK 回应 -> 再审核/报告升版 -> AnnotatedDocument/Report` 端到端验收。
- 已完成合同存在“审核完成但无正文/无 Word 批注产物”的数据质量缺口。
- 文档比对已完成本地成功路径和异常边界验证；仍需线上 Production 部署后复验。
- Feishu 真实上游同步、成员导入边界和 Unauthorized 场景需要在配置凭据后线上复验。
- 配置中心错误态已修代码，但 401/403/500 故障注入自动化仍未补。

### 0.3.1 组织角色成员分配追加修复

本小批次只处理 BUG-P1-016/BUG-P1-017 的代码、API 回归和本地生产浏览器证据，不代表组织权限链路已线上完成。

修复内容：

- `app/configs/tabs/RoleDetailPanel.tsx`：批量添加角色成员时，如果部分成员写入成功、部分失败，成功部分会先关闭弹窗并刷新组织/角色聚合数据，再提示失败原因，避免用户看到“添加后无刷新”的假失败。
- `app/api/admin/users/[id]/roles/route.test.ts`：补齐角色分配 API 的无效 JSON、非法角色 ID、无权限、目标用户不存在、成功替换、角色不存在 6 个回归用例。

已跑验证：

- `pnpm exec vitest run 'app/api/admin/users/[id]/roles/route.test.ts'`：1 个测试文件、6 个测试通过。
- `pnpm test:run`：103 个测试文件、436 个测试通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过；`/configs` First Load JS 129 kB。
- 本地生产浏览器 `http://localhost:3011/configs?tab=role-access`：
  - READONLY 初始 0 人。
  - 添加 `e2e-admin@huarun.com` 后，READONLY 列表和详情计数变为 1；网络请求出现 `POST /api/admin/users/00030001-0000-0000-0000-000000000000/roles` 200，随后 `GET /api/admin/org` 200 与 `GET /api/roles` 200。
  - 页面内 fetch `/api/admin/org` 返回该用户 `role_codes=["ADMIN","READONLY"]`。
  - 移除该用户后，READONLY 列表和详情计数回到 0；再次 fetch `/api/admin/org` 返回 `role_codes=["ADMIN"]`。
  - 浏览器 console error/warning 为 0。

仍需验收：

- 线上 Production 复验同一流程，确认没有缓存、权限或部署版本导致的假空态。

### 0.3.2 ReviewRun 证据适配层追加修复

本小批次只处理 BUG-P0-011 的第一阶段证据适配层，不代表 F006 真实 SkillBundle 编译、F012 ModelPolicy 发布和 ModelInvocation 审计已经完成。

修复内容：

- `lib/contracts/review-evidence.ts`：新增 ReviewRun 证据构造器，用已有 `contract_rules_v2`、`contract_rule_snapshots` 和 `contract_analysis_jobs` 生成 `evidence_status`、`rule_snapshot_refs`、`skill_bundle_id`、`rule_snapshot_id` 和 `model_policy`。
- `app/api/contracts/[id]/review/route.ts`：合同审核工作台 API 不再返回纯合成的 `contract-rules:published`，而是读取当前组织规则、已发布快照和最近分析任务。
- `app/contracts/[id]/page.tsx`：审批情况中展示证据状态、规则快照数量和模型来源，便于人工验收。

已跑验证：

- `pnpm exec vitest run lib/contracts/review-evidence.test.ts`：1 个测试文件、3 个测试通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过；`/contracts/[id]` First Load JS 129 kB。
- 本地生产 API `GET /api/contracts/44301b16-6551-4720-afa5-f1d80b1604de/review`：
  - `reviewRun.evidence_status = snapshot_bound`
  - `reviewRun.rule_snapshot_id = contract_rule_snapshots:published:15`
  - `reviewRun.rule_snapshot_refs.length = 15`
  - `reviewRun.model_policy_id = model-policy:manual-fallback:degraded`
  - `reviewRun.model_policy.source = analysis_job.provider`
- 本地生产浏览器桌面 `http://localhost:3013/contracts/44301b16-6551-4720-afa5-f1d80b1604de`：
  - 审批情况显示“已绑定规则快照”“快照数量 15”“模型来源 分析任务记录”。
  - 浏览器 console：0 errors、0 warnings。
- 本地生产浏览器 390x844：
  - 合同工作台可显示同一批证据字段。
  - `document.documentElement.scrollWidth = 390`、`window.innerWidth = 390`，未观察到新增横向溢出。
  - 浏览器 console：0 errors、0 warnings。

剩余不能标完成的关键缺口：

- `skill_bundle_id` 仍是由规则快照适配出来的稳定标识，不是真实 F006 编译产物。
- `model_policy_id` 仍来自最近分析任务 provider，不是真实 F012 已发布 ModelPolicy。
- 当前样本没有风险项和批注，尚不能证明 `RiskFinding -> CommentPatch -> AnnotatedDocument/Report` 闭环。

仍需验收：

- 线上 Production 复验同一合同工作台 API 和桌面/移动端 UI，确认部署版本、权限和数据快照一致。

### 0.3.2.1 F006/F012 真实对象与再审核触发追加修复

本小批次关闭“F006/F012 只有适配层”和“再审核触发未跑通”的当前阶段缺口，但不代表完整 Skill 控制台、模型连接健康检查和客户反馈状态机已经完成。

复用资产：

- `contract_rules_v2`、`contract_rule_snapshots`、`clause_library`：作为 SkillBundle 编译输入，不新增第二套规则表。
- `configs` 中已发布 `AI_CONFIG`：作为 ModelPolicy 来源，不在合同审核代码里写死最终模型策略。
- `contract_reviews`：继续作为 ReviewRun 承载对象，追加 Skill/Model/再审核字段，不新增平行 ReviewRun 表。
- `contract_analysis_jobs`、`contract_risk_cards`、`contract_annotations`、`contract_versions`、`report_versions`：继续承载分析、风险、批注和版本归档。

修复内容：

- 新增 `contract_skill_bundles`、`model_policies`、`model_invocations` 三个真实运行对象，并把 `skill_bundle_id`、`model_policy_id`、`rule_snapshot_ids`、`model_invocation_ids`、`review_trigger`、`parent_review_id` 绑定到 `contract_reviews`。
- `lib/contracts/skill-bundle.ts` 从已发布规则快照、条款库引用、输出 schema 和模型策略编译 SkillBundle，并用内容 hash 去重。
- `lib/contracts/model-policy.ts` 从已发布 AI 配置解析运行策略，缺失时显式降级到内置规则兜底 provider，并记录 ModelInvocation。
- `POST /api/contracts/:id/review-runs` 支持在非运行中 ReviewRun 上触发再审核，写入父子关系和触发原因。
- 审核工作台 API 读取真实 SkillBundle / ModelPolicy / ModelInvocation 证据，并把风险卡限定到最新 ReviewRun，避免再审核后新旧风险叠加。
- 导出 API 限定最新 ReviewRun 风险，并输出 `Server-Timing` / `X-Export-Timing` 拆分耗时。
- 登录 API 在 RPC 900ms 截止之外，追加 fallback 外部 I/O deadline，避免 Supabase transport 抖动时继续卡住几十秒。

已跑验证：

- Supabase 远端迁移已应用：`20260701033715_f006_f012_runtime_objects`；远端存在 `contract_skill_bundles`、`model_policies`、`model_invocations`，`contract_reviews` 存在新增绑定列。
- 本地 production API 临时样本：
  - `POST /api/contracts/:id/analyze` -> `COMPLETED`
  - `POST /api/contracts/:id/review-runs` -> `COMPLETED`
  - `GET /api/contracts/:id/review` 返回 `skill_bundle_id=ebadf3c9-71cc-4f84-823d-9e7240599220`、`model_policy_id=10c90eb1-5a7d-4acf-b048-5e9a68e2feb0`、`model_policy.source=model_policies`、`model_invocation_ids=[aff366bd-360a-4d5c-bc55-690388cac2b2]`、`SNAPSHOT_COUNT=5`。
  - `POST /api/contracts/:id/export` 返回 docx，`X-Export-Timing=review_data_load;dur=174.4, clauses_load;dur=195.6, annotations_load;dur=172.9, risk_patches_load;dur=179.5, versions_load;dur=167.0, storage_download;dur=859.4, source_temp_write;dur=1.7, docx_generate;dur=18.4, output_file_read;dur=0.1, storage_upload;dur=319.5, version_register;dur=175.9, report_version_link;dur=191.3`。
  - 临时合同已删除；两次临时导出 Storage 对象已清理，`STORAGE_REVIEWED_REMOVED=2`。
- Word 人工打开验收：`/tmp/word-open-ones-review-front.png` 显示 Microsoft Word 已打开样本 docx，右侧存在 `ONES 业务运营` 两条原生批注；WPS 当前环境未安装，不能宣称已验收。
- 登录单测新增 fallback transport timeout 覆盖：`LOGIN_TRANSPORT_TIMEOUT` 会快速返回 503，并在 timing header 标记超时阶段。
- 当前批次质量门禁：`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`（110 个测试文件 / 458 个用例）、`pnpm build`、`git diff --check` 均通过；真实浏览器桌面/移动端 smoke console error/warning 为 0。

仍需验收：

- 线上 Production 主域同账号复验初审、再审核、审核证据、Word 批注导出和登录 timing。
- 若后续安装 WPS，需要补 WPS 人工打开验收；当前只能记录为 Word 已通过、WPS 未执行。

### 0.3.3 CommentPatch 适配层追加修复

本小批次只处理 BUG-P0-014 的 `RiskFinding -> CommentPatch -> contract_annotations` 适配层，不代表 Word/WPS 人工打开验收、降级 UI 和完整报告归档已经完成。

复用资产：

- `contract_risk_cards`：继续作为第一阶段 RiskFinding 事实表，不新增平行风险表。
- `contract_annotations`：继续作为批注意图/CommentPatch 落地点，不新增平行批注表。
- `lib/export/word-generator.ts`：继续负责 Word 原生批注写入和报告兜底，不重写导出器。
- `app/api/contracts/[id]/export/route.ts`：继续负责导出文件、写入 `contract_versions.source = review_revision`，不新增第三套导出入口。

修复内容：

- `lib/contracts/comment-patch.ts`：新增可测试的 CommentPatch 适配层，从红/黄风险卡生成 `risk_finding` 批注草稿，并通过 `RiskFinding: <id>` 保留风险项追溯。
- `lib/contract-analysis.ts`：分析保存时复用同一适配层，不再内嵌第二套批注生成逻辑。
- `app/api/contracts/[id]/export/route.ts`：导出时优先消费已有 `contract_annotations`；若历史风险卡缺少对应批注，则即时生成并持久化缺失批注，再进入 Word 导出。
- `lib/export/word-generator.ts`：修复自闭合 `word/_rels/document.xml.rels` 时 comments relationship 未写入的问题，避免生成的 docx 有 `comments.xml` 但缺少 Word 关系引用。

已跑验证：

- `pnpm exec vitest run lib/contracts/comment-patch.test.ts lib/contracts/review-evidence.test.ts lib/export/word-generator.test.ts`：3 个测试文件、7 个测试通过。
- `lib/export/word-generator.test.ts`：用最小 docx zip 验证输出包含 `word/comments.xml`、`w:commentRangeStart`、`w:commentReference` 和 comments relationship。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过；`/api/contracts/[id]/export` 在构建路由表中存在。
- 本地 production API 抽样：
  - 登录 `e2e-admin@huarun.com` 成功。
  - `GET /api/contracts` 返回 6 条合同。
  - `GET /api/contracts/c0319a20-eec1-493f-8ea1-bbd1b408a4f8/review` 返回 8 个风险、7 条批注、8 个输出版本、`evidence_status = snapshot_bound`。
  - 另 3 个 completed 样本为 0 风险、0 批注，用于确认不能把 0 风险样本当作批注验收样本。

仍需验收：

- 在专门的可重置验收样本上调用导出 API，下载 docx 后用 Word/WPS 打开，确认原生批注存在且定位合理。
- 人工确认导出失败时的降级原因在 UI 和 API 中可见，而不是把报告兜底伪装为完整批注能力。
- 线上 Production 复验同一链路，并确认导出产生的 `contract_versions.review_revision` 不污染默认业务样本。

### 0.3.4 NegotiationTask / CustomerFeedback 适配层追加修复

本小批次只处理 BUG-P1-022/BUG-P1-023 的“不要新增第二套谈判/反馈对象”问题，不代表真实客户接受/拒绝/反建议、再审核和报告升版已经完整闭环。

复用资产：

- `ask_items`：作为第一阶段 NegotiationTask 的持久化对象，承载 pending/responded/closed 状态、责任角色、问题和合格标准。
- `ask_responses`：作为第一阶段 CustomerFeedback/业务回应承载，不新增平行反馈表。
- `ask_audit_logs` / `ask_role_assignments` / `report_versions`：保留为后续状态审计、角色分发和报告升版资产。
- `app/api/contracts/[id]/asks/generate/route.ts`：已有从开放红/黄风险卡生成 ASK 的能力，后续应作为真实谈判任务生成入口。

修复内容：

- `lib/contracts/negotiation-task.ts`：新增可测试适配层，优先把真实 ASK 映射为谈判任务；只有没有 ASK 覆盖的开放红/黄风险才 fallback 为 `risk_card_suggestion`。
- `app/api/contracts/[id]/asks/generate/route.test.ts`：补 ASK 生成入口测试，覆盖从开放红/黄风险卡生成谈判任务，以及已有 ASK 时复用不重复生成。
- `app/api/contracts/[id]/review/route.ts`：读取 `ask_items` 与 `ask_responses`，按当前用户角色过滤，返回真实谈判任务、责任角色、合格标准和回应。
- `app/contracts/[id]/page.tsx`：谈判任务卡片展示状态、责任角色、ASK 编号、合格标准和回应内容。
- `app/api/contracts/[id]/asks/route.ts`、`app/api/contracts/[id]/asks/[askId]/route.ts`、`app/api/contracts/[id]/review/route.ts`：修复 PostgREST `PGRST201`，显式使用 `ask_responses!ask_responses_ask_id_fkey`，避免 `ask_items.response_id` 和 `ask_responses.ask_id` 双外键歧义导致 ASK 查询失败。
- `lib/ask/relations.ts`、`lib/contracts/negotiation-task.ts`、`lib/ask/report-version.ts`、ASK 列表/详情/报告版本 API：收敛 PostgREST 1:1 关系返回对象或数组两种形态。真实远端验证显示 `ask_responses!ask_responses_ask_id_fkey` 会因唯一关系返回对象，旧代码用 `[0]` 导致工作台状态为 responded 但看不到 response。
- `lib/ask/report-version.ts`：复用既有 `report_versions`，在 ASK 回应后生成 `trigger_event=ask_responded` 的当前报告快照，不新增第二套反馈/报告表；插入新 current 前先将旧 current 置 false，插入失败时尽量恢复，兼容旧数据库中 `idx_report_versions_unique_current` 已存在但 BEFORE 触发器尚未应用的状态。
- `lib/ask/submit-response.ts`：ASK 从 `pending` 更新为 `responded` 后，写入 `report_versions` 并追加 `report_generated` 审计事件；响应体返回 `report_version` 或 `report_version_error`。
- `app/api/contracts/[id]/review/route.ts` 与 `app/contracts/[id]/page.tsx`：审核工作台返回并展示当前报告版本摘要，用户可见 ASK 总数、已回应、待处理和已关闭数量。
- `app/api/contracts/[id]/reports/current/route.ts`：当前报告读取不再直接 select `no_ask_explanation`，在历史 schema 未补齐前返回 `null`，避免非关键说明字段导致当前报告 API 500。
- `supabase/migrations/20260701023032_backfill_report_versions_no_ask_explanation.sql`：补齐历史 migration 顺序导致的 `report_versions.no_ask_explanation` 缺列风险；只做 `ADD COLUMN IF NOT EXISTS`。
- `supabase/migrations/20260701024500_fix_report_versions_current_trigger.sql`：修复 `report_versions` 当前版本滚动触发器顺序。历史 migration 先建 `idx_report_versions_unique_current`，但触发器为 `AFTER INSERT`，会在旧 `is_current=true` 存在时先触发唯一约束失败；新 migration 改为 `BEFORE INSERT OR UPDATE OF is_current`，在约束检查前把同合同旧 current 置为 false。

已跑验证：

- `pnpm exec vitest run app/api/contracts/[id]/asks/generate/route.test.ts lib/ask/report-version.test.ts lib/ask/submit-response.test.ts lib/contracts/negotiation-task.test.ts app/api/contracts/[id]/asks/[askId]/responses/route.test.ts app/api/asks/[askId]/responses/route.test.ts`：6 个测试文件、14 个测试通过，覆盖 `风险卡 -> ASK -> 回应 -> report_versions`、1:1 关系对象形态、旧 current 失效和响应 schema。
- `pnpm exec vitest run lib/ask/submit-response.test.ts lib/ask/report-version.test.ts lib/contracts/negotiation-task.test.ts lib/contracts/comment-patch.test.ts lib/export/word-generator.test.ts lib/contracts/review-evidence.test.ts app/api/contracts/[id]/asks/[askId]/responses/route.test.ts app/api/asks/[askId]/responses/route.test.ts`：8 个测试文件、17 个测试通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过；`/contracts/[id]` First Load JS 130 kB。
- `pnpm exec supabase db lint --local --fail-on error`：未跑通，本地 `127.0.0.1:54322` 未启动 Supabase Postgres，错误为 `connect: connection refused`；数据库 migration 仍需在可连接的本地或远端 schema 上补验。
- 本地 production API：
  - `GET /api/contracts/c0319a20-eec1-493f-8ea1-bbd1b408a4f8/review` 返回 `riskFindings=8`、`annotations=7`、`negotiationTasks=7`、`negotiationSources=["risk_card_suggestion"]`。
  - `GET /api/contracts/c0319a20-eec1-493f-8ea1-bbd1b408a4f8/asks` 返回成功，`askItems=0`，确认 PGRST201 已消除；该样本暂无真实 ASK，因此只能验证 fallback。
- 本地 production 浏览器：
  - 桌面 1440x900：合同工作台显示“谈判任务”“待处理”“必须谈判/建议谈判”，`scrollWidth=clientWidth=1440`，无 `页面发生错误`，console error/warning 为 0。
  - 手机 390x844：合同工作台显示谈判任务区域，`scrollWidth=clientWidth=390`，无 `页面发生错误`，console error/warning 为 0。
  - 截图保存在 ignored 的 `product-truth/product-code/output/playwright/contract-workbench-negotiation-desktop.png` 和 `...-mobile.png`，不作为提交资产。
  - 追加复核：桌面 1440x900 与手机 390x844 均可见“报告版本”区块和报告状态，`scrollWidth=clientWidth`，无 `页面发生错误`，页面消息为空；截图保存在 `product-truth/product-code/output/playwright/contract-workbench-report-desktop.png` 和 `...-mobile.png`。
  - 临时可清理样本 `runId=1782874878955`：通过 API 创建临时合同，service role 只插入两条临时风险卡；应用 API 生成 2 条 ASK；两次 `/asks/{askId}/responses` 均返回 201，`reportVersion` 分别为 1 和 2；`GET /review` 返回 `currentReportVersion=2`、`summary={total:2,pending:0,responded:2,closed:0}`、版本列表为 `v2 current=true / v1 current=false`、两条谈判任务均 `source=ask/status=responded/hasResponse=true`。
  - 同一临时样本手机 390x844 真实 Chrome：页面显示“报告版本”“报告 v2”“已回应”、ASK 编号和临时回应文本，`scrollWidth=clientWidth`，page error/console error 为 0；截图为 ignored 文件 `product-truth/product-code/output/playwright/ask-report-temp-1782874878955-mobile.png`。
  - 清理闭环：同一临时合同通过应用 `DELETE /api/contracts/{id}` 删除，service role 复核 `contracts`、`contract_risk_cards`、`ask_items`、`report_versions`、`ask_responses` 残留均为 0。
- 本地 production 导出 API：
  - 临时可清理样本 `runId=1782875081484`：生成最小源 docx 上传 Storage，插入完成审核记录、原始 `contract_versions v1` 和红线风险卡；调用 `POST /api/contracts/{id}/export` 返回 200，`content-type=application/vnd.openxmlformats-officedocument.wordprocessingml.document`，`Content-Disposition` 为 attachment。
  - 下载结果 docx 结构校验：存在 `word/comments.xml`、作者 `ONES 业务运营`、风险批注“付款周期过长”、`<w:commentRangeStart>`、`<w:commentReference>` 和 `/relationships/comments`。
  - 版本登记：导出后存在 `contract_versions v2 source=review_revision`，`parent_version_id` 指向 v1，`change_summary=ONES 业务运营基于风险项生成 Word 批注版本`。
  - 清理闭环：应用 `DELETE /api/contracts/{id}` 删除临时合同，脚本显式移除源文件和导出文件两个 Storage path；service role 复核 `contracts`、`contract_reviews`、`contract_versions`、`contract_risk_cards`、`contract_annotations` 残留均为 0。
  - 追加 `report_file_url` 回写样本 `runId=1782875245020`：预置当前 `report_versions v1` 后调用导出 API，结果 docx 同样包含原生批注结构；`contract_versions v2 source=review_revision` 的 storage path 与 `currentReport.report_file_url` 完全一致；清理后源文件、导出文件、`contracts`、`contract_reviews`、`contract_versions`、`contract_risk_cards`、`contract_annotations`、`report_versions` 残留均为 0。
  - 性能观察：同一导出请求服务端日志耗时 42.7s，应进入 B4 性能拆解；当前只证明功能闭环，不证明导出性能达标。

仍需验收：

- 明确“客户接受/拒绝/反建议”是否继续复用 `ask_responses.attachments/payload`，还是需要在后续阶段补独立枚举字段。
- 再审核触发仍未闭环；导出 API 已证明可生成 Word 原生批注文件、`contract_versions.review_revision` 和 `report_versions.report_file_url` 关联。
- Word/WPS 人工打开验收仍未完成；当前只做 zip 结构级验证。
- 线上 Production 复验 ASK 列表、详情和 review 工作台三处不再出现 PGRST201。

### 0.3.5 合同上传入口与版本记录追加修复

本小批次只处理 B2 中“上传入口混乱”和“分片上传未形成 ContractVersion”的可直接闭环部分，不代表合同审核商业对象闭环完成。

修复内容：

- `app/contracts/page.tsx`：合同中心“上传合同”主入口改为 `/contracts/upload`，复用既有分片上传、进度、拖拽、提交审核与审核启动链路；旧 `/contracts/new` 保留为合同档案/元数据补录，不再作为“上传并审核”的主入口。
- `app/contracts/[id]/compare/page.tsx`：无可比合同时引导补充回传件/候选合同；当前合同缺源文件时“补充可比对文件”进入 `/contracts/{id}/edit`，避免新合同上传和当前合同版本替换混用。
- `app/api/contracts/[id]/merge-chunks/route.ts`：分片合并成功后补写 `contract_versions`，返回 `versionNumber` 和 `versionSource`，与非分片 `/upload` 路由保持同一合同版本事实。
- `app/api/contracts/[id]/merge-chunks/route.test.ts`：补充成功路径，验证主上传链路合并后会创建版本记录。
- `app/api/contracts/[id]/compare/route.ts` 与 `app/contracts/[id]/compare/page.tsx`：文档比对按同报价、同客户或 legacy 同上传者关系过滤候选和已有结果，避免 Hemory 等跨产品样本被默认拿来比对。

已跑验证：

- `pnpm exec vitest run 'app/api/contracts/[id]/compare/route.test.ts' 'app/api/contracts/[id]/merge-chunks/route.test.ts' 'app/api/contracts/[id]/upload/route.test.ts'`：3 个测试文件、11 个测试通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过。
- 本地生产浏览器：`/contracts` 桌面入口和 390px 手机底部入口均显示起草/上传/审核/比对分流；上传入口进入 `/contracts/upload`。
- 本地生产浏览器历史样本：真实 DOCX `ones-upload-e2e-1782811200.docx` 完成创建合同、分块上传、merge、submit、analyze，当时进入旧 `/contracts/f025ea6b-8156-434c-bda6-2e2ec764a615/review` 并显示原文和风险点；后续 BUG-P1-025 已将旧审核入口收口到主工作台 `/contracts/{id}`，需按新入口复验。
- DB 复核：`contract_versions` 写入 version 1、source `original`、storage_path 与文件大小正确；随后通过 DELETE 清理测试合同，复核 `contracts=0`、`contract_versions=0`。
- 本地生产浏览器/API：旧污染比对 `/contracts/c0319a20-eec1-493f-8ea1-bbd1b408a4f8/compare` 不再展示 Hemory 差异，页面显示已排除 3 份非同客户/同报价合同；直接 POST Hemory 比对返回 400。

仍需验收：

- 线上 Production 复验发起审核入口、比对页补充可比对文件跳转、当前合同编辑页补充文件。
- 合同审核商业闭环仍缺真实 `ASK 生成 -> ASK 回应 -> 再审核/报告升版 -> AnnotatedDocument/Report` 完整验收；`CommentPatch` 已补适配层，但 Word/WPS 打开验收仍未完成。

### 0.3.6 品牌主题默认回退与配置中心复验

本小批次只处理 BUG-P0-005 的品牌主题假消失、旧品牌回退和配置中心 P0 假空态复验，不代表合同审核商业产品闭环完成。

修复内容：

- `lib/ui-theme-shared.ts`：默认主题从 Cyanlog 回退改为 `ONES Sales / 智能协作平台`，覆盖未登录、配置读取超时、配置缺字段和错误边界的默认品牌。
- `app/layout.tsx`、`app/business-map/page.tsx`、`app/tech-architecture/page.tsx`：服务端 metadata 标题不再回退旧品牌。
- `app/configs/dialogs/ThemeEditForm.tsx`：编辑已有 UI_THEME 配置时先经 `sanitizeThemeValue` 合并默认值，避免旧配置缺品牌字段时表单显示空值。
- `app/configs/tabs/ThemeTab.tsx`：主题列表直接显示品牌、浏览器标题、侧栏副标题，避免用户只能看到色板而误判品牌配置消失。
- `supabase/migrations/20260604000003_seed_ui_theme_config.sql`：默认 seed 增加品牌、标题、登录文案、brandAssets 和 appearance。
- `supabase/migrations/20260630174000_backfill_ui_theme_brand_defaults.sql`：为既有 UI_THEME 记录补齐缺失品牌字段；只填缺省值，不覆盖租户已配置字段。

已跑验证：

- `pnpm exec vitest run lib/ui-theme-shared.test.ts app/api/configs/route.test.ts 'app/api/configs/[id]/route.test.ts'`：3 个测试文件、4 个测试通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm lint`：通过。
- `pnpm test:run`：103 个测试文件、438 个测试通过。
- `pnpm build`：通过；`/configs` First Load JS 129 kB。
- 本地生产 HTTP 首屏：`/login`、`/business-map`、`/tech-architecture` 的 HTML title 均为 `ONES Sales`，没有 `Cyanlog` 字符串，favicon/shortcut/apple-touch 链接存在。
- 本地生产浏览器未登录页：标题、登录页品牌、DOM `data-product-title/data-brand-name` 和 favicon 均为 ONES 主题。
- 本地生产浏览器登录态 `/configs?tab=theme`：主题方案 1、已发布 1、草稿 0；主题卡显示“品牌：ONES Sales / 标题：ONES Sales / 副标题：智能协作平台”；编辑弹窗品牌字段有值和 ONES 占位。
- 本地生产浏览器 390x844：`/configs?tab=theme` 无横向溢出，品牌可见，旧品牌未出现。
- 同一 390x844 登录会话复验配置中心 P0 假空态：组织架构 11 部门/25 成员/3 销售空间；角色权限 7 角色；合同审核策略 15 条规则且 R001-R015 可见；三页均无横向溢出。

仍需验收：

- 线上 Production 应用 migration 后复验已有 UI_THEME 记录是否补齐品牌字段。
- favicon 仍需在线上浏览器标签页实际刷新后确认，不仅看 HTML link。

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
| 冷登录 | 最近参考样本 `/api/auth/login` 1173ms，整体登录约 1590ms；`dpl_DcsLG4sdNEDESWJiwF12SErXE8iA` 直提样本为 `X-Login-Timing total=1021.6ms`。`c0d23a9` 后登录页改为预热同一路由；`cb176af` 后 Vercel Functions 固化到 `sin1`。最终 `dpl_GPh5F5bZDMwGsTAHuGewTDboEgUe` 预热后提交样本为 166.0ms、120.0ms、112.1ms。`bde4752` 后预热覆盖 `login_with_password_v1` 无副作用分支，并新增 `login_rpc_transport`；Preview `dpl_86ysbsC1CGXZjH3YG2mxytNrZzrw` 登录样本为 `total=147.6ms`、`rpc_total=98.4ms`、`login_rpc_transport=39.9ms`。`006f41e` 后慢登录会输出脱敏阶段日志。`762c830` 后预热接口增加 `X-Login-Prewarm-Timing`，并给每个无副作用预热任务默认 1500ms 软边界。最新本地生产复核显示 5 次直提的 `rpc_total` 只有 78.1-109.3ms，而 `login_rpc_transport` 可到 178.1-1552.0ms；完整预热后有一笔 252.0ms，但 350ms/1200ms 预热并发提交仍可落到 552.1ms/842.1ms。 | 暖路径可低于 0.5s，且现在能区分数据库内耗、外部传输等待和预热任务长尾；但生产冷登录仍需等 Preview 切流后在主域复测。当前证据不支持继续盲改预热时间，也不支持把 `initialDashboard` / `initialCore` 当作主瓶颈。 | 保留 `X-Login-Timing`、`X-Login-Prewarm-Timing`，用 `rpc_password_verify`、`login_rpc_transport`、预热任务状态和慢日志分别跟踪数据库计算、外部等待与线上长尾；若主域复测仍是 transport 高，下一步进入 Supabase/PostgREST 连接、区域和网络策略。 |
| 外部网络等待 | 诊断中 Supabase/GitHub TLS reset 曾导致核心 API 拖到约 9s 后 401；网络恢复后核心 API 回到约 185-355ms。`762c830` 的本地生产验证中，`POST /api/auth/prewarm` 对 `login_rpc` 返回 `dur=1501.8;status=timed_out` 并输出脱敏 `[auth/login] prewarm timeout`。 | 外部依赖不是一概删除对象，但必须区分可控代码耗时和不可控网络等待；机会型预热不能无限占用请求。 | 对外部请求记录错误类别、耗时和降级结果；生产部署后用预热 header 和日志复测。 |
| 配置与组织包体 | 早期诊断样本显示 `/configs` First Load JS 约 281kB；中间构建为 166kB；`c74ad23` 后为 160kB；`56ba7e3` 将配置编辑弹窗和版本历史弹窗整体移出首包后，最新本地构建 `/configs` 为 Size 15.4kB、First Load JS 129kB。`0d15f8c` 将 `/admin/org` 的组织工作台动态加载后，生产构建从 73.2kB / 245kB 降到 3.78kB / 107kB，线上 chunk 9,078 bytes；`4bc49c6` 保持 `/admin/org` 为 3.78kB / 107kB。 | 两个配置/组织入口的首屏专属代码已拆小；`/configs` 已低于 `/contracts` 144kB，接近 `/tenders` 126kB，剩余关注点是共享 chunk 和真实首次进入耗时。 | 持续记录 build 输出；下一步优先看共享 chunk 或真实 first-entry trace，而不是继续盲拆小表单。 |
| 登录页 CLS | 登录页 trace 曾显示 CLS 约 0.21；`be7c882` 后线上桌面 1440x900 与手机 390x844 采样均为 CLS 0。 | 当前登录页布局稳定性已恢复；CLS 属登录页问题，不属于配置/合同/标书切页问题。 | 保留为回归基线，后续主题/品牌变更后复测。 |

本轮不保留未经验证的性能改动。曾尝试把登录预热从 1200ms 提前到 350ms，但快速提交样本退化到约 5s，因此撤销；最新本地 production 样本也显示 350ms/1200ms 预热并不能稳定压低 `login_rpc_transport`。后续必须先补观测，再做优化。当前生产环境中 Vercel 未透出应用设置的 `Server-Timing`，所以登录链路以镜像 header `X-Login-Timing` 作为验收证据。

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
| `F027-remediation-governance.md` | 缺少跨问题域合并、验收、发布证据的稳定 truth。 | 当前 0.x 段以 G0/G1-G11、PD01-PD10、47 条结构化 Bug、B0-B5 批次和执行看板为准；旧 D01-D10/P0-P4 只保留为历史证据来源。 |
| `04-implementation-truth/manifests/F027/*` | 需要保留本轮线上证据、命令证据、发布证据。 | 记录当前验证结果、部署 ID、线上路径、剩余风险。 |
| `04-implementation-truth/manifests/F027/api-validation-inventory.md` | API schema 覆盖债务不能只用粗略数量表达，否则容易把 manual guard 误判为已完成或未修复。 | 固化 103 个 API route 的 body-parse 分类：67 个 `schema+guard`、0 个 `guard-only`、36 个 `no-body`；ASK 回应路由按已测试的共享 helper schema 计入。 |

---

## 7. 历史批次定义

本节保留 2026-06-26 旧版 F027 的 P0-P4 批次定义，用于理解历史修复和线上验收记录。当前继续执行时，以 0.2.2 的 B0-B5 批次和 0.2.2.1 执行看板为准；本节不得作为当前完成状态的唯一依据。

| 历史批次 | 覆盖问题域 | 当时完成信号 |
|---|---|---|
| P0 | D01、D02、合同详情错误 | 主域名可访问，合同详情不进入 error boundary，Production Ready。 |
| P1 | D03-D06、D08 | 管理员、规则、合同上传/比对、知识库新建的线上用户路径可跑通。 |
| P2 | D07 | 手机/iPad 核心页面无横向失控，favicon 线上可取。 |
| P3 | D09-D10 | 临时文件不入库，部署上传边界明确，质量命令通过。 |
| P4 | 长期治理 | 冷登录 RPC、真实飞书同步、Vercel webpack cache big-string build note 等进入后续治理。 |

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
| 超管成员增删复核 | 最新本地生产浏览器 run `1782493268886` 复核用户截图中的超管疑点：`SUPER_ADMIN` 的权限设置只读是设计约束，但员工分配可编辑。临时用户 `codex-super-admin-1782493268886@example.com` 通过 UI 加入超级管理员后 `/api/admin/org` 返回 `role_codes=["SUPER_ADMIN"]`，移除后返回 `role_codes=[]`，随后临时用户被删除且组织聚合不再返回该用户。桌面 1600px 与移动端 390px 均无横向溢出，添加成员入口可见。 |
| 组织聚合耗时分层 | `4bc49c6` 在 `/api/admin/org` 响应中加入 `X-Org-Payload-Source` 和 `X-Org-Timing`；最新生产部署 `dpl_DDfZfD9oNiuRgdA4EkNYExFAb1ic` 上真实登录后返回 `source=rpc`、`auth;dur=0.2, rpc_payload;dur=55.5, total;dur=55.9`、25 用户 / 11 部门 / 7 角色 / 3 销售空间。 |
| 管理员写接口参数校验 | `/api/admin/users/[id]/departments`、`/login-enabled`、`/report-to` 增加 Zod body/query 校验；坏参数返回 `400 VALIDATION_ERROR`，并由测试确认不会访问 Supabase。最新生产部署同样对空 `department_ids`、字符串 `login_enabled`、非法 `report_to_user_id` 返回 400。API Zod 覆盖从 36/103 提升到 39/103。 |
| 管理员写接口 JSON 分类 | `8dd29e3` 复用既有 Zod schema 与 route 测试体系，把 `/api/admin/departments`、`/api/admin/departments/[id]`、`/api/admin/users`、`/api/admin/users/[id]`、`/api/admin/users/[id]/roles` 的 malformed JSON 从 generic 500 改为 `400 VALIDATION_ERROR`；最新生产部署五条线上样本均返回 400。 |
| 认证与通用接口 JSON 分类 | `1a521a4` 将同一处理方式扩展到 `/api/auth/login`、`/api/auth/register`、`/api/auth/change-password`、`/api/profile`、`/api/client-errors`；`cdc118c` 将 public API allowlist 改为精确匹配并放行旧注册入口 `/api/auth`。`dpl_6ZME8coENZdgts2ThnPkjq21xez4` 线上验收中 `/api/auth` 与 `/api/auth/register` malformed JSON 均为 400，`/api/auth/me`、`/api/auth/login-extra`、`/api/health-extra` 未登录仍为 401。 |
| 配置中心写接口 JSON 分类 | `ff9f4bd` 复用既有配置 schema，让 `/api/configs`、`/api/configs/[id]`、`/api/configs/[id]/rollback` 的 malformed JSON 进入 400 校验分支；`dpl_GCdMNrSB1RQj1jtxcabmsV6zrr5e` 三条线上样本均返回 400。 |
| 配置中心派生 API envelope | `44adc21` 将 `/api/configs/[id]`、`/publish`、`/versions`、`/rollback` 从旧 `{ error, code }` / 裸数据响应收敛到 `lib/api/common` 的 `{ success, data/error }`。`ConfigsClient` 同时兼容新旧错误对象和版本列表响应，避免前端把 error object 直接渲染成 React child。目标测试 3 个文件 / 3 个用例、定向 lint、typecheck、build 和浏览器登录态配置页验证均通过。 |
| 日程 API envelope | `cbf6e3c` 将 `/api/agenda` 与 `/api/agenda/upcoming` 收敛到 `lib/api/common` 的 `{ success, data/error }`。日程新建页兼容旧字符串错误和 common `error.message`；核心页日程预热继续读取 `data`。目标测试 2 个文件 / 5 个用例通过，覆盖 upcoming 列表 envelope、创建 201 envelope 和非法 body 400 envelope。中间件未登录 401 是全局 API 边界，本批次不混入修改。 |
| 角色 API envelope | `2a0ca9f` 将 `/api/roles` 与 `/api/roles/[id]` 收敛到 `lib/api/common` 的 `{ success, data/error, meta }`。配置中心继续复用既有 `data.roles` 和 common `error.message` 读取，不新增第二套角色 UI。目标测试 2 个文件 / 4 个用例通过，覆盖无权限、列表 meta、非法 PATCH body 和 PATCH 成功 envelope。中间件未登录 401 是全局 API 边界，本批次不混入修改。 |
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
| 登录 RPC 预热与外部等待拆分 | `bde4752` 复用既有 `/api/auth/login` 预热入口和 `login_with_password_v1`，用空参数命中 input validation 分支，避免写入登录尝试或 token；同时在 `X-Login-Timing` 增加 `login_rpc_transport`，明确外层 Supabase/PostgREST/网络/序列化等待。Preview `dpl_86ysbsC1CGXZjH3YG2mxytNrZzrw` 验证：health 200、数据库 120ms；prewarm 200；login 200，`total=147.6ms`、`rpc_total=98.4ms`、`login_rpc_transport=39.9ms`。`762c830` 继续复用这两条预热入口，没有新增登录 API；本地生产 `GET /api/auth/login` 预热响应带 `users_query/candidate_rpc/login_rpc` 阶段 header，`POST /api/auth/prewarm` 在 `login_rpc` 超过 1500ms 时返回 `status=timed_out`。最新本地 production 复核补充了反例：直提与并发预热样本中 `rpc_total` 稳定较低，但 `login_rpc_transport` 可成为 450ms-1552ms 长尾。 |
| 轻量登录预热与交互刷新 | 当前本地批次没有新增登录 API，继续复用 `/api/auth/login` 与 `/api/auth/prewarm`，但预热任务从 `users_query/candidate_rpc/login_rpc` 收窄为单条 `login_rpc` 无副作用分支，避免冷启动时三条 Supabase/PostgREST 请求互相竞争。登录页首屏 100ms 触发预热；用户在登录页继续点击、键盘或聚焦时，如果上次预热已超过 4 秒且没有在途预热，会刷新同一轻量预热。质量门禁：`pnpm exec vitest run app/api/auth/login/route.test.ts app/api/auth/prewarm/route.test.ts` 为 2 个文件 / 21 个用例通过，`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm build` 均通过。API 采样：`GET /api/auth/login` 预热响应仅有 `login_rpc;dur=310.8;status=fulfilled`，随后登录 route total 为 321.0ms、423.6ms、267.0ms、283.4ms。真实浏览器复核先复现风险：一次预热 40 多秒后提交仍出现 `total=1092.1ms`、`login_rpc_transport=997.8ms`；交互刷新后，等待 6.5 秒再聚焦输入触发刷新预热，网络出现 3 次轻量 GET 预热（710.1ms / 796.8ms / 536.6ms），POST 登录 `total=313.7ms`、`login_rpc_transport=198.1ms`，页面进入首页且 console error 为 0。结论：修复了“预热过期后提交仍冷”的前端策略问题，但 Supabase/PostgREST 外部传输长尾仍按 G9 继续观察，不能据此关闭全部冷登录性能目标。 |
| 慢登录阶段日志 | `006f41e` 复用现有 login timing collector，没有新增第二套性能埋点；当 `/api/auth/login` route total >=500ms 时输出脱敏 `[auth/login] slow timing` warning，包含 `login_rpc`、`rpc_token_write`、`rpc_initial_dashboard`、`rpc_initial_core`、`login_rpc_transport`、`auth_context_cookie` 等阶段耗时。单元测试确认日志不包含邮箱、用户 ID 或展示名。 |
| 最新 Preview 视觉验收 | `dpl_86ysbsC1CGXZjH3YG2mxytNrZzrw` 通过临时 Vercel share URL 在真实浏览器中打开 `/login`、`/`、`/configs?tab=role-access`。桌面 1440x900 和手机 390x844 截图均无 `页面发生错误`；首页、配置中心角色权限桌面和移动端均无横向溢出；移动端汉堡按钮可见，角色成员新增入口可见。截图保存在 ignored 的 `product-truth/product-code/output/playwright/` 下，只作为本地证据，不进入 Git 或 Vercel payload。 |
| 最新主域切流 | `480471b` 后 repo-root `vercel deploy --yes` 上传 210.7KB，生成 Ready Preview `dpl_YKeSNAKpJFwVu1mTaVea571AZ9PQ`；随后 `vercel promote https://cyanlog-sales-v3-j84pl8zrd-eoins-projects-94b17ece.vercel.app --yes` 成功创建 Production deployment `dpl_3SY9pJkSKsyN7m5jYzbTwcXSjGM5`。`vercel inspect sales.cyanlog.icu` 显示 target `production`、status Ready、alias 包含 `https://sales.cyanlog.icu`。 |
| 首页 cookie-only 会话恢复 | 浏览器验收发现 `/` 在只有 HttpOnly cookie、没有 `localStorage.token` 时会被客户端重定向到 `/login`，而同一 cookie 下 curl/HTML 服务端已经能渲染首页。`480471b` 复用既有 `loadHomeInitialData`、`/api/auth/me`、`/api/dashboard` 和首页预热资产，让首页支持 cookie-only 会话，不新增第二套首页 API。本地生产和主域 smoke 均显示 `/` 渲染工作台，不出现登录页或错误边界。 |
| 最新主域视觉验收 | `sales.cyanlog.icu` 指向最新 artifact 后，真实浏览器验证 `/`、`/configs?tab=role-access` 和 `/contracts/44301b16-6551-4720-afa5-f1d80b1604de`。桌面 1440px、移动 390px 均无横向溢出；角色权限与添加成员入口可见；合同详情不进入 `页面发生错误`。一次移动端 React #418 pageerror 没有在后续 5 次移动端重复样本中复现，暂列为部署/缓存窗口 watch，不作为已确认稳定 bug。Production promote 后主域 health/login/org/rules API 复核继续通过；post-promote 浏览器 smoke 的 page/console errors 为空。 |
| 最新角色增删 UI 验收 | 主域浏览器使用现有 `e2e-admin@huarun.com` 做临时角色赋予，不新增生产用户：进入 `READONLY`，点击添加成员并选择该账号后，角色列表、详情计数和已分配表格均刷新为 1；`/api/admin/org` 确认 `role_ids` 包含 READONLY；随后通过 UI 移除，角色列表和详情回到 0，API 确认原始 `ADMIN` 角色恢复，过程无 page error / console error。 |
| 最新规则与组织接口验收 | 主域 `/api/rules/stats` 默认返回 15 条当前 active 规则，未包含旧 `RULE-01-*`；显式 `include_archived=true` 返回 18 条并保留历史行。`/api/admin/org` 返回 25 用户、11 部门、7 角色，`X-Org-Payload-Source: rpc`，`X-Org-Timing` 约 `auth;dur=0.3, rpc_payload;dur=41.0, total;dur=41.4`。 |
| 合同详情错误边界复核 | `dpl_8ppMSoM9i8vFdLSeLfPZebFkQiV5` 上用浏览器打开用户截图中的 `/contracts/44301b16-6551-4720-afa5-f1d80b1604de`，页面渲染标题、基本信息、审核任务和 AI 风险点，不再显示 `页面发生错误`。 |
| 首页快速跳转噪声 | `dpl_DcsLG4sdNEDESWJiwF12SErXE8iA` 上快速从 `/` 跳到 `/configs?tab=role-access`，`fastNavigationConsoleMessages=[]`，不再把被导航中止的 dashboard fetch 当作页面错误噪声。 |
| 聚合接口边界 | `/api/admin/org` POST/PATCH 不再承载旧写逻辑，误用时返回 `405`、`Allow: GET`、`ORG_AGGREGATE_READ_ONLY`；写操作复用 `/api/admin/users` 与 `/api/admin/departments`。 |
| 规则统计旧规则隔离 | `/api/rules/stats` 默认只统计 `is_active=true` 的 `contract_rules_v2` 当前规则，避免归档 `RULE-01-*` 再次被用户理解为当前规则；需要排查历史规则时显式传 `include_archived=true`。目标测试 1 个文件 / 2 个用例通过。 |
| 登录 route 预热 | `dpl_7J1TDiARGGbW39XuDRzM8jrrkSuQ` 上 `/login` 自动触发 `GET /api/auth/login` 200；无 header 的 GET 返回 204，不触发数据库预热；有 `X-Login-Prewarm: 1` 才预热。 |
| 函数区域 | `cb176af` 在 `vercel.json` 固化 `"regions": ["sin1"]`；最终部署 `dpl_GPh5F5bZDMwGsTAHuGewTDboEgUe` 的 `vercel inspect` 显示 functions 在 `[sin1]`，`/api/health` 返回 `x-vercel-id hnd1::sin1`。 |
| 冷登录现状 | 预热后提交阶段 `X-Login-Timing total` 为 166.0ms、120.0ms、112.1ms；`6aac024` 缓存 auth context HMAC key 后，生产登录 route total 为 315.0ms、154.5ms、124.5ms、110.3ms、109.8ms，其中 `auth_context_cookie` 首次 13.8ms、后续 0.4-0.5ms。`bde4752` Preview 登录 route total 为 147.6ms，`login_rpc_transport` 为 39.9ms。最新 Production promote 后 API 登录样本为 `total=190.7ms`、`rpc_total=112.1ms`、`login_rpc_transport=68.7ms`；同一轮浏览器 smoke 登录样本为 `total=513.3ms`、`rpc_total=98.8ms`、`login_rpc_transport=381.8ms`。因此主域可用性通过，但冷登录 <0.5s 目标仍按外部传输长尾继续观察，不能靠盲调预热时间关闭。 |
| 配置中心拆包 | `56ba7e3` 复用既有 `next/dynamic` 方案，把配置编辑弹窗和版本历史弹窗整体改为打开时加载，没有新增第二套配置 UI；最新本地构建为 `/configs` 15.4kB / 129kB，低于 `/contracts` 144kB。浏览器使用本地生产服务验证：真实登录后税率新增弹窗、主题新增弹窗均能加载，控制台错误和真实网络失败为空。 |
| 组织管理拆包 | `0d15f8c` 复用同一动态加载方案，把 `/admin/org` 的组织工作台延后加载；最新生产部署 `dpl_GCdMNrSB1RQj1jtxcabmsV6zrr5e` 登录态 `/admin/org` 200，页面 chunk 9,078 bytes；最新构建仍为 `/admin/org` 3.78kB / 107kB。 |
| 本地构建依赖 | 本地缺失的 `@next/swc-darwin-arm64` 生成包/链接已恢复，`pnpm build` 不再出现 SWC fallback warning；`4507ae2` 通过 `serverExternalPackages` 让 Sentry/OpenTelemetry Node instrumentation 走 server external，不再出现 `require-in-the-middle` dynamic require warning；`56ba7e3` 最新构建继续无该 warning。 |
| Sentry 无 DSN 启动噪声 | `instrumentation.ts` 在没有 `SENTRY_DSN` 和 `NEXT_PUBLIC_SENTRY_DSN` 时不再导入 server/edge Sentry 配置；本地 `next start -p 3000` 不再输出 server Sentry disabled warning。构建期 OpenTelemetry dynamic require warning 已由 `4507ae2` 的 `serverExternalPackages` 关闭，不通过关闭监控来消除。 |
| Sentry/OpenTelemetry 构建 warning | `4507ae2` 复用 Next `serverExternalPackages`，不关闭 Sentry 监控，只让 `@sentry/nextjs` / `@sentry/node` / `@opentelemetry/instrumentation` / `require-in-the-middle` 退出 server bundling。Local `pnpm build` 不再出现 Sentry/OpenTelemetry dynamic require warning；`next start -p 3010` Ready，`GET /api/health` 返回 200。 |
| Vercel 生产部署额度 | 已关闭。此前 `api-deployments-free-per-day` 阻塞过 promote，但最新一次 promote 成功，主域已是 Production target。 | 后续按 Production deployment `dpl_3SY9pJkSKsyN7m5jYzbTwcXSjGM5` 验收。 |
| 部署产物 | 最新 Production artifact 为 `dpl_3SY9pJkSKsyN7m5jYzbTwcXSjGM5`，由 Ready Preview `dpl_YKeSNAKpJFwVu1mTaVea571AZ9PQ` promote 而来；Preview repo-root 上传 210.7KB，build Ready，函数 `[sin1]`，`/configs` 15.4kB / 129kB，`/admin/org` 3.77kB / 107kB，`/` 7.2kB / 174kB。项目根仍是 `product-truth/product-code`；本地 `node_modules`、`.next`、`output/playwright` 截图证据和 `tsconfig.tsbuildinfo` 都被 ignore，没有进入 Git 或 Vercel payload。 |
| 依赖声明清理 | 精确 import 搜索确认 `@ai-sdk/anthropic`、`react-window`、`@types/react-window` 和直接 `js-yaml` 没有代码引用；`pg` 只被 `scripts/apply-migrations.mjs` 与 `scripts/test-pg-conn.mjs` 使用。已移除 4 个未引用直接声明，并把 `pg` 从生产 dependencies 移到 devDependencies；生产 direct dependencies 从 31 降到 27。该批次 `480471b` 质量门槛为 `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run` 102 个测试文件 / 427 个测试通过、`pnpm build` 通过；当前批次验收以 0.3 为准。 |
| Sharp 构建脚本 | `7eded60` 只批准 `sharp` 进入 `pnpm.onlyBuiltDependencies`；`dpl_F8ZGdXqXQU3LDKU9YbatoZE9Yxhm` 执行 `sharp@0.34.5 install/check.js` 并完成，后续生产构建不再出现 ignored build scripts warning。 |
| 测试命令噪声 | `pnpm test:run` 固化 `NODE_OPTIONS=--no-experimental-webstorage` 后，当时 hook 全量测试为 102 个测试文件 / 427 个测试通过，且不再输出 Node 24 `--localstorage-file` warning；当前批次验收以 0.3 为准。 |
| Lint 命令噪声 | `pnpm lint` 从 `next lint` 切到 ESLint CLI，覆盖 `app/components/lib/types` 与根运行配置文件；命令通过且不再输出 Next 16 废弃提示。 |
| E2E 命令与知识库新建入口 | 当前批次没有新增第二套 E2E runner 或知识库页面，复用既有 `@playwright/test`、`playwright.config.ts`、`e2e/critical-path.spec.ts`、`app/knowledge/page.tsx` 和 `app/knowledge/new/page.tsx`。`package.json` 补齐 `test:e2e`、`test:e2e:headed`、`test:e2e:install`；`playwright.config.ts` 改为显式 `BASE_URL` 时不启动本地 dev server；`e2e/README.md` 的凭证统一为 `e2e-admin@huarun.com / E2ETestPassword123!`。验证：`BASE_URL=http://localhost:3012 pnpm test:e2e --list` 成功列出 1 个文件 / 8 条 E2E；`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm build` 均通过。知识库本地生产浏览器验证：登录后 `/knowledge` 桌面有 `新建` 按钮，点击进入 `/knowledge/new`，显示“新建知识库页面”表单且 console error 为 0；390px 移动视口 `/knowledge` 与 `/knowledge/new` 均 `scrollWidth=clientWidth=390`，点击新建同样进入创建页。该结果关闭本地 B5/B6 复现，但仍需线上域名复验后才能从 F027 关闭。 |
| 合同审核入口收口 | 当前本地批次复用既有合同主工作台 `/contracts/[id]`、上传页、提交 API 和编辑页，没有新增第三套审核页面。`/contracts/[id]/review` 改为服务端重定向主工作台；`/contracts/upload` 上传完成跳转和 `/api/contracts/[id]/submit` 返回的 `reviewUrl` 统一为 `/contracts/{id}`；主工作台不再使用“上传新版本”作为审核动作，补充客户回传件/候选合同进入 `/contracts/{id}/edit` 的 `ContractVersion` 版本流。质量门禁：`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm build` 均通过。真实浏览器本地 production 验证：登录后访问 `/contracts/44301b16-6551-4720-afa5-f1d80b1604de/review` 最终 URL 为 `/contracts/44301b16-6551-4720-afa5-f1d80b1604de`，页面展示审批情况、风险定位、谈判任务、原文与风险定位、版本与产物、Word 批注，console error 为 0；390px 手机视口 `scrollWidth=clientWidth=390` 且无 `页面发生错误`；点击补充文件入口进入 `/contracts/44301b16-6551-4720-afa5-f1d80b1604de/edit`，console error 为 0。该结果关闭本地 BUG-P1-025 复现，并修正同问题域下当前合同版本补充入口；仍需线上域名复验。 |
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
