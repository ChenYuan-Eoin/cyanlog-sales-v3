# F099-当前开发工作包账本

**Status**: active_work_package_ledger
**Updated**: 2026-07-20
**Ledger Version**: v2026-07-20.01
**Scope**: 把长期产品目标拆成可排队、可验收、WIP=1 的开发批次
**Portfolio Goal Source**: `product-truth/REQ_REGISTRY.yml#goal_governance`
**Active Queue Source**: `governance/runtime-state/active-task.json`

---

## 0. 唯一当前工作包快照

编号语义固定如下：`G1-G11` 是不可变长期产品组合目标；`WP00-WP09` 是开发工作包；`F` 是 Feature Packet；`IN` 是需求输入；`DG` 是历史交付门禁；`HG0-HG5` 是 Harness 执行门禁。WP 完成不自动关闭 G。

2026-07-10 至 2026-07-18 本账本曾把近期执行包写成 `G1-G9`。这些旧别名现在一一映射为 `WP01-WP09`；下方历史证据已按 WP 归一显示，原始截图目录、运行记录和证据文件名不改名。

| 工作包 | 主要产品目标 | 状态 | 进入/退出边界 |
|---|---|---|---|
| WP00 目标基线整合 | G1/G10/G11 | Completed / `18dad230` | 已统一 REQ、主文档、F099、调度、Harness 与发布候选 |
| WP01 AI 平台底座 | G4；支撑 G3/G7 | **Active** / reacceptance | Provider、模型目录、AI 应用、业务用点分层；不得按合同场景写死模型 |
| WP02 AI 运行真实性 | G3；支撑 G7/G10 | Next / needs_current_runtime_proof | 当前 provider probe、真实 invocation/token、ReviewRun、降级链 |
| WP03 规则集合产品化 | G3/G4；支撑 G7/G10 | queued / acceptance_disputed | 规则集→问题分类→具体规则→规则详情→属性/判定/处理 |
| WP04 合同中心入口 | G6；支撑 G8 | queued / needs_reacceptance | 起草、审核、对比及任务身份、版本、下一步 |
| WP05 多格式循环复审 | G2；支撑 G3/G6/G8/G10 | parked / NO-GO | 新源文件+事前独立金标；补文件版本、风险迁移和循环复审产品验收 |
| WP06 文档对比 | G6；支撑 G7/G8/G10 | completed_preview_candidate_not_production | 保留既有 Preview 证据；Production 只能由 WP09 复验 |
| WP07 合同起草 | G6；支撑 G2/G8/G10 | queued | 可编辑草稿、版本、DOCX 导出、转审核/对比 |
| WP08 横切体验伞 | G5/G8 | must_split_before_activation | 激活前拆为品牌主题、组织交互、响应式 Shell，禁止混成一个开发批次 |
| WP09 工程发布验收 | G7/G8/G9/G10/G11 | queued | 唯一 Git 候选、测试/build、桌面/iPad、文件、Preview/Production |

当前唯一 Active ID 是 `WP01`（slug: `ai-platform-foundation`），Next 是 `WP02`。WP00 已由提交 `18dad230bbc12a6cf664e5868cc25d57bbb65fd3` 固化完成；旧混合任务 `P0-ONLINE-SYNC-RULE-COLLECTION-RESET` 已拆成 WP01、WP03、WP09，只保留历史追溯。WP01-WP04 的旧“本地完成”总括结论已被最新用户验收推翻，不再是当前状态。

> 本节以下全部是历史开发与证据记录，只能证明对应局部事实；状态冲突时以本节、REQ_REGISTRY 和 active-task 为准。

## 1. 历史开发与证据快照

### 0.0 2026-07-18 WP06 旧/新合同原文级文档对比：Preview 候选验收完成

用户已看到 `IN-20260718-034` 的序列切换影响并明确要求继续推进。WP05 不作完成声明，保持 `NO-GO / waiting_external_gold`：已有代码、Preview 证据、真实候选 8/13 chunk 失败、`blind_accuracy=not_evaluated` 与 `release=false` 原样保留；取得全新源文件和模型运行前锁定的独立人工金标后，重新进入需求序列，不得自动抢占后续 Active。

WP06 的产品合同与退出证据如下：

- 用户上传明确的旧文件和新文件；比较创建时冻结两侧组织、合同、存储路径、文件名、MIME、大小、文件 SHA-256、文本 SHA-256、解析文本、渲染模式和页级映射。后续合同源变化不得使历史比较漂移。
- DOCX/DOCM 复用 WP05 已验证的浏览器 OOXML 高还原预览；PDF 使用应用可控页图，不用 iframe 冒充可控缩放与定位。旧/新角色清楚，支持 60%-180% 缩放、适宽、独立/同步滚动和差异跳转。
- 差异必须绑定双侧原文和位置；重复、移动、增删改文本使用确定性算法和负向测试。扫描 PDF 没有可靠文本时可预览并明确降级，不伪造差异。
- 导出真实 DOCX 差异报告，包含双侧源身份/SHA、统计和逐项旧/新原文及位置；证据不全时 fail closed，不生成假报告。
- 只在免费隔离 Preview 写 forward migration；比较详情、源文件、页图和报告全部按组织隔离，快照不可改删。Production 继续只读，不 push、不部署。
- 持续或按量付费依赖全部淘汰；CSPP/WOPI、WPS WebOffice、OnlyOffice 和在线协同不进入主线。只有量化后仍绕不过去的一次性费用才单独进入用户决策。

WP06 已关闭为“可审计 Preview 产品线候选”，不是 Production 已发布：

- 免费 Preview `vsfropnfsmnonkotywsx` 的 `070000/071000/072000` 迁移与事务破坏探针通过；合法第二组织成员可以创建，伪造源身份/差异范围、快照或差异改删、旧版直写均被拒绝，事务回滚后 comparison/diff/source 为 0。
- 两份真实 DOCX 与两份文本 PDF 完成 API、冻结字节/SHA、源变化不漂移、桌面 `1440×1000`、iPad `1180×820`、60%-180% 缩放、适宽、独立/同步滚动、首尾差异跳转和报告下载。DOCX/PDF 分别产生 6/4 处确定性差异。
- 两份真实 DOCX 报告通过 OOXML ZIP 回读与 LibreOffice 全页渲染复核，SHA-256 为 `168d8d099ebf6482bdc05da0283cc924e28ecb4925f420f1271ec025d9b17b45` 和 `a70317a19c50b79c472d6d4b5fe080e668481fb5ba6fa88656750223ceb2af0`。
- 9 个目标测试文件/55 用例、TypeScript 与 Preview-bound Next.js 81/81 build 通过；浏览器 blocking console/request/HTTP/API 全为 0。原始事件完整保留，只有 localhost 下两个精确 Vercel 观测脚本 404 为 non-blocking，Production 不继承此豁免。
- 验收 fixture、冻结源、token 与 8 个 Storage 对象已精确清理为 0，三道不可变 guard 保持启用。证据入口为 `product-code/output/evidence/g6/preview-browser-acceptance.json`、`preview-browser-cleanup-verification.json` 与 `product-code/output/playwright/g6/`。
- Supabase 组织套餐为 Free；没有注册付费账号、没有新建收费分支、没有持续/按量费用。Production 未写，未 push、未创建 PR、未部署。WP07 仍是 Next，需建立自身结构化目标后再成为唯一 Active，不在本批静默扩张。

以下 v19-v25 保留为 WP05 历史验收与停靠证据，不再代表当前 Active。

### 0.0.1 WP05 历史基线与停靠证据

用户已确认产品基线并批准继续开发。当时旧 Active 标签为 `G5-MULTIFORMAT-ANNOTATION`（现映射为 WP05），WP06 顺延为 Next。此前“WP05 只差 WPS 打开验收”的结论被新产品事实推翻：提审材料并非只有 DOCX，完整闭环必须覆盖 Word 文件族和 PDF，且不得把在线 Office 平台当作前置依赖。

本批支持范围与交付合同（2026-07-17 用户重新确认）：

- 输入支持 `.doc / .docx / .docm / .pdf`；独立 `.png / .jpg / .jpeg` 不在范围，但页面内容为图片的扫描 PDF 必须支持。
- 统一批注锚点包含文本范围、归一化区域和归一化位置。OCR 只提升扫描 PDF 的自动定位；OCR 低置信或失败时仍允许人工框选或放置批注钉。
- Word 审阅预览必须尽可能还原页式布局，并显示源文件已有修订与批注；浏览器消费的 PDF/页图只是 rendition，不是交付原件，也不得反向生成交付文件。
- DOCX 以源文件为事实源并在副本上增量写入 Word 原生批注；DOCM 同样增量写入，服务器不得执行宏，导出前后宏相关部件必须字节级一致。既有修订、批注、页眉、页脚和正文不得被重建或覆盖。
- DOC 是可上传和预览的 legacy Word 输入，但 P0 不再研发同格式二进制批注写回。生成 AI 原生批注版前要求用户在 Word/WPS 另存为 DOCX；系统保留原 DOC，不静默转换，也不输出重新渲染的伪原件。
- PDF 以原页面为事实源并写入标准 PDF annotation；文本 PDF 支持文字锚点，扫描 PDF 即使无可用文本层仍支持页坐标批注。
- CSPP、WPS WebOffice、OnlyOffice、在线正文编辑与实时协同均不属于本批。Word/WPS/PDF 阅读器只作为真实导出文件验收工具。

#### 2026-07-18 v19：精度门禁已执行，结构链通过但候选 NO-GO

- Preview 冻结锚点校验已从约 3.9 秒/49 次 helper 调用降至 17.612 毫秒；49 条风险完整 stage 在 1.483 秒内通过，伪造 source hash 仍以 `23514` 原子拒绝。性能问题不再掩盖模型与规则问题。
- 首轮 Qwen 合成基准经修正计分器复核为 P=.755、R=.822、F1=.787、明确无风险特异度=.40。服务端唯一 `rule_code -> frozen snapshot` 绑定、冻结 chunk 内唯一空白差异锚点修复和 `compact-v2` 输出合同关闭了 7 条无效绑定与 4 条原文错位。
- 按“只允许一次回归”的熔断规则，零成本本地 Qwen 最终回归完成 11/11 invocation、50,702 tokens、ReviewRun 与 Job；结构诊断的 unbound/unlocated/invalid binding/source mismatch/duplicate/failed/skipped 全为 0。准确率提升到 TP42/FP4/FN3、P=.913、R=.933、F1=.923，但 severity=.833、无风险特异度=.40、R004 recall=.60，仍未过门禁，`release_acceptance=false`。
- 剩余问题已经从“模型调用/锚点链不可信”收敛为三类：Level A/green 不应物化客户风险；R007/R013 缺少 conflict/specificity 机器裁决；R015 缺少 default-unknown 等级。普通直审现已只物化 red/yellow，26/26 单测、typecheck 与 81/81 build 通过；已归档分数不追溯改写。
- 同一 50 页重复合成 fixture 已被看过，禁止继续调 prompt、重复跑模型或写固定文案特判刷分。下一阶段必须发布新的不可变规则包候选，由确定性 adjudicator 产出等级，并使用全新、人工标注、非重复的真实合同盲测小集验收。
- 最终 Preview 浏览器显示桌面/iPad `46/46` 风险且无横向溢出，iPad 显示真实第一页；桌面原文标记在 60 秒内未出现，保持浏览器门禁未通过。6 个基准合同及 6 ReviewRun/job/page-map、57 invocation、95 risk、6 个 Storage 对象与测试 token 已精确清理为 0；v21 bundle、policy、15 个规则快照、13 个规则集快照完整保留。
- 本批增量费用为 0 美元：未注册或购买任何付费模型/服务，持续付费依赖继续默认淘汰。Production 未写、未 push、未部署。

#### 2026-07-18 v20：原文 canary 关闭，确定性裁决进入事实抽取批次

- 免费隔离 Preview `vsfropnfsmnonkotywsx` 的 source-only canary 于 `2026-07-17T20:08:40.838Z` 完成，未调用模型、未发生付费动作、未触碰 Production。桌面 `1440×900` 在 8.627 秒进入 `ready`，iPad `1180×820` 在 6.028 秒进入 `ready`；两端均显示 50 个 section、命中第 1/50 页锚点、根页面无横向溢出且无意外请求失败。canary 合同、Storage、page-map、token 及关联数据清理后残留全为 0，v19 的桌面 60 秒原文门禁因此关闭。
- 证据固定为 `output/evidence/g5-v12/g5-source-only-canary-browser-20260718.json`（SHA-256 `451337ae...d765e`）、桌面截图 `g5-source-only-canary-desktop-20260718.png`（`cad2e275...b5d7`）和 iPad 截图 `g5-source-only-canary-ipad-20260718.png`（`2b652808...20e9`）；这些证据只证明原文加载与版面可达，不声明法律审核准确率。
- 确定性 adjudicator 及迁移合同测试已通过；`20260718040000_add_deterministic_adjudication_candidate_bundle.sql` 与 `20260718041000_bind_adjudication_trace_to_frozen_review.sql` 已按顺序在 Preview 验证。测试候选包与 adjudication trace 残留为 0，原 v21 bundle、model policy、15 个规则快照和 13 个规则集快照均未改变，Production 未写。
- 对 v21 全部 15 条规则的只读审计结论是：现有规则说明属于可供法务复核的转译草案，不是可以直接发布的确定性判定合同。下一候选必须使用类型化事实 schema、白名单算子、互斥的 A/B/C 判定包络与显式 unknown；同时修补 R004 区间/边界、R007/R013 冲突与特异性，以及 R015 未知事实的人工复核降级。审计结果本身不得直接发布。
- WP05 继续保持 `NO-GO`。下一最小开发批次只实现事实抽取 runtime，随后形成经过产品真相审查的新不可变规则包候选，再用全新、人工标注、未见过的真实合同小集做盲测；不得重跑已看过的 50 页合成 fixture 刷分，也不得进入 WP06、push 或部署 Production。

#### 2026-07-18 v21：facts_v1 本地底座完成，ReviewRun 全链仍未闭合

- `facts_v1` 已与 legacy 风险输出显式隔离。模型只能提交规则代码、逐字原文和类型化 facts，不能提交 severity、标题、建议或物化 ID；每个冻结 chunk 必须为全部冻结规则声明 `observed / not_observed / uncertain` coverage。
- 服务端已实现冻结 source/chunk 哈希与范围校验、完整且唯一的 `1..N` chunk 合并、重叠去重、事实冲突整文 fail-closed、文档级 coverage 和确定性 A/B/C/unknown 及冲突裁决。独立 provider path 强制完整组织/合同/ReviewRun/job/bundle/policy/chunk 身份、精确 invocation ID 和非零 token 证据，legacy 入口拒绝消费 `facts_v1`。
- Preview 迁移 `20260718042000_harden_adjudication_trace_immutability.sql` 与 `20260718043000_freeze_deterministic_rule_provenance.sql` 已应用并动态验证：trace 为 1-based 且 append-only；规则 criteria hash 由 PostgreSQL 在插入时生成；已发布规则/规则集快照及 bundle 内容不可变，仅允许移动 `is_current` 指针。事务内 hash、错误 hash、更新/删除和 ACL 破坏演练全部通过后整体回滚，残留为 0。
- 当前 v21 仍是唯一 current legacy bundle，compiled hash 为 `7d492ccea7b67f4363b6ae30ca112ab4`，15 个 legacy rule snapshot 的 criteria hash 仍为 null，13 个 rule-set snapshot 不变，candidate channel 和 adjudication trace 均为 0。6 个目标测试文件 98/98、`tsc --noEmit` 和隔离 Next.js 14.2.35 build 81/81 通过。
- 以上只关闭本地事实抽取/裁决和冻结资产底座，不代表 facts-only 已进入真实 ReviewRun、provider 已重新调用、15 条事实合同已获产品认可或准确率已改善。下一最小批次是审核 15 条事实合同，补原子 `invocation -> trace + coverage` staging，再生成不可变候选并使用全新真实合同盲测。WP05 继续 `NO-GO`；持续付费依赖默认淘汰，Production 未改，不得进入 WP06、push 或部署。

#### 2026-07-18 v22：原子事实证据层完成，主阻断回到规则产品真相

- facts_v1 在记录成功调用前先按冻结 `fact_schema` 校验，验证后的原始/归一化 facts 被复制并冻结；每批携带规则目录指纹，禁止仅因 `rule_code` 相同而混合不同 snapshot/criteria。最终 trace 构建要求完整 `1..N` chunk 均有 invocation 身份和非零 token，并在落库前重算 candidate/criteria 指纹、重放确定性裁决与冲突抑制。
- 提交路由、直接 Worker 和决策 Worker 对尚未完成的 facts_v1 物化链实行三重 fail-closed：不会误走 legacy 风险链，也不会把只完成证据 staging 的 ReviewRun 标成完成。
- Preview 已应用 `20260718044000_add_atomic_facts_review_staging.sql` 与向前性能修复 `20260718045000_add_facts_staging_fk_indexes.sql`。service-role-only RPC 在一个事务中校验租约、ReviewRun、source/page-map、preview candidate、模型 invocation、raw output hash、token、完整 chunk 和 `chunk × rule` coverage，再写入 append-only fact run/chunk/coverage/trace；明确返回 `review_completed=false`，不创建风险卡、不切 current、不发布候选。
- 动态验收覆盖成功+精确幂等、错误租约、零 token、错误 raw hash、不完整 coverage、两 chunk 全部 `not_observed`、审计行改删拒绝、已发布 bundle 删除拒绝及 operational invocation 删除不改审计。所有演练均在事务内回滚，fact run/chunk/coverage/trace、candidate channel 和 fixture 残留均为 0；匿名/登录角色无执行或写权限，安全顾问只有 service-role-only 表无浏览器 policy 的预期 INFO。045 后新增复合外键缺索引提示为 0。
- 15 条 legacy 规则仍不能直接转为候选：R002/R004/R005 与 R013 的候选部分最接近可机器化，但仍需产品真相确认；R001/R006/R009/R011/R014/R015 缺业务判定口径；R003/R007/R008/R010/R012 依赖整文缺失证据或外部事实，其中 R010 不能靠合同原文自行证明。不得伪造 source quote 为“缺少条款”出卡。
- runtime 已把文档级结果显式分成 `source_span_candidates / complete_not_observed_coverage / uncertain_coverage`，并附候选 ID 与逐 chunk 状态。该字段只陈述证据基础：全文均 `not_observed` 仍需冻结规则明确声明缺失有风险，才可形成无原文锚点的文档级待办；人工选定批注位置前不得导出原生批注。15 条推荐口径详见 `F005v2` v22.1。
- 当前主阻断不是性能，也不是付费模型，而是先定义整文缺失/外部事实的可审计产品合同并审核 15 条规则，再接 candidate-start Worker、风险物化和 ReviewRun 完成链。`/api/contracts/process` 缺少仓内调度是独立发布门禁，不混入本批事实合同。目标测试 4 文件 57/57、`tsc --noEmit` 与隔离 Next.js 14.2.35 build 81/81 通过；没有调用模型或产生费用。WP05 仍为 `NO-GO`，Production 未改，不得进入 WP06、push 或部署。

#### 2026-07-18 v23：文档级裁决已可审计，Worker 接缝保持非终态熔断

- 下一 Preview 候选的每条冻结规则现在必须声明 `absence_decision = ignore / yellow_review / red_risk`。runtime 把 `source_span_candidates`、`complete_not_observed_coverage` 与 `uncertain_coverage` 分开裁决：不确定证据只能黄灯人工核验；全文完整未观察到时只按冻结规则的缺失语义决定忽略、黄灯或红灯；任何文档级发现都不得伪造 `source_quote` 或原文锚点。
- Preview 已应用 `20260718050000_add_document_scope_adjudication_contract.sql`：append-only 的 document run 即使 0 条结果也会冻结规则目录、coverage 与裁决 hash；逐规则 outcome 记录证据基础、缺失语义、决策、等级和是否物化。`stage_contract_review_facts_v2` 在同一数据库事务中先写 044 facts 证据，再由冻结 coverage/规则生成整文裁决；仍明确 `risk_cards_materialized=false`、`review_completed=false`。浏览器角色无读写/执行权，service role 只能通过 RPC 写入并只读审计表；旧 v1 RPC 已撤销执行权，runtime 不能绕回半套链路。
- 首版 v2 曾错误要求“原始候选数必须等于最终 trace 数”，与运行时对重叠 chunk 的相同事实去重冲突。该问题在接入 Worker 前被负向审查发现，已用向前迁移 `20260718051000_allow_overlap_deduplicated_facts_stage.sql` 删除无效等式，同时保留“observed 规则至少一条 source trace、unobserved 规则不得有 source trace”的规则级不变量；没有重写已应用迁移历史。
- 动态 Preview 最终状态为 fact run 0、document run 0、document outcome 0、preview candidate 0；v1 不可执行、v2 仅 service role 可执行，新增两表的 RLS、ACL 与 append-only trigger 均实测成立。安全顾问没有新增 WARN；性能顾问只有新表尚未使用的预期 INFO。v21 仍是唯一 current legacy bundle，Production 未写。
- Worker 已具备受租约保护的 facts-only provider 调用、全 chunk 合并、source trace/document outcome 构建、v2 RPC 和严格 receipt 对账 helper，但暂不连接直接执行分支。原因是 v2 故意非终态：若现在接入，会在 staging 后停止心跳并留下 running job，重试还可能制造新 invocation、冲突和费用。现有直接分支继续 fail closed，等风险卡物化与 ReviewRun 完成能在同一租约下连续完成，或先定义可恢复的 staged 状态后再启用。
- 目标测试 5 文件 106/106、`tsc --noEmit` 与隔离 Next.js 14.2.35 build 81/81 通过。本批没有模型调用、账号注册、购买或持续费用。下一阻断是产品/法务语义而非技术授权：确认 15 条规则的类型化事实、A/B/C 阈值及缺失/外部事实输出口径，再实现风险物化与 ReviewRun 完成、创建非 current Preview 候选并使用全新真实合同盲测。WP05 继续 `NO-GO`，不得进入 WP06、push 或部署 Production。

#### 2026-07-18 v24：真实单合同运行失败，确定性重试与传输归一化已收口

- `052/053` 已把 facts 证据、风险物化、完成 receipt 与 ReviewRun 终态接成同一受租约保护的服务端链；`054/055` 提供非 current Preview 候选的创建和启动合同。`063/064` 形成运行时校准后的 v23 候选，`065/066` 增加可恢复的逐 chunk 原子 checkpoint、一次有界续跑和 source-anchor 强校验；这些迁移只进入免费隔离 Preview，v21 仍是唯一 current legacy bundle。
- 受控单 chunk DOCM canary 已完整通过：ReviewRun `765147ec-7d73-468b-a1b2-15516c4f6985`、job `ae6d8568-c876-4440-a532-e8c9006834a7` 一次完成，1/1 checkpoint 的 source anchor 有效，Qwen invocation 为 2,504 input + 496 output tokens，并形成 15 条 document outcome、13 张风险卡和 1 份 completion receipt；源文件路径、SHA 与文本 SHA 均未改变。该结果只证明运行与审计链可闭合，不证明法律审核准确率。
- 首份新真实 DOCX 候选运行未通过 runtime 门禁：ReviewRun `f0f0225f-2cbe-47c6-917f-e2af5346e839`、job `14541e1d-9df1-450d-91d8-33c32ecdb27c` 在第 8/13 chunk 因 `facts.compensation_basis` 超出冻结 enum 失败；一次有界续跑保留了 1..7 checkpoint，但同一确定性错误再次出现后终止。最终 7/13 checkpoint 均有有效 source anchor，未整文重跑、未创建第二个 ReviewRun、未写 fact run/receipt/risk card，源路径与两个 SHA 前后完全一致。
- 该失败暴露的是错误分类而非性能：确定性 schema/enum 错误不应进入任务级重试。`067` 已限定模型传输归一化为可证明的格式别名、冻结 schema 明示的 `unknown` 或 nullable `null`，不得猜测业务值；同时修复 coverage 审计保留、空白投影一致性、重叠重复 quote、幂等 checkpoint 的 source-anchor 门禁和 normalization count 对账。Preview 事务/ACL/postflight 通过，4 个目标文件 103/103 测试与 `tsc --noEmit --incremental false` 通过。
- 这次真实候选的 `runtime_acceptance=failed`、`blind_accuracy_acceptance=not_evaluated`、`release_acceptance=false`。本批没有再跑第三次模型；当前批次未重跑 build、桌面/iPad 浏览器或原生文件导出，因此历史通过证据不得冒充本批验收。完整非原文证据见 `output/evidence/g5-v12/g5-facts-v23-terminal-audit-20260718.json`。
- 增量费用仍为 0 美元：没有注册账号、购买服务或调用付费外部 Provider。WP05 保持 `in_progress / NO-GO`；下一步先用离线与 Preview 事务证明 `067` 的确定性失败/续跑边界，再准备新的代表性人工金标合同集，不继续重复调用同一失败样本。Production 只读，不得进入 WP06、push 或部署。

#### 2026-07-18 v25：checkpoint 到 staging 的空白一致性已动态闭合

- 可复现 Preview 事务探针从真实候选的一个已验证 chunk 克隆临时身份，在 source quote 中只插入一个空格，然后依次调用 `checkpoint_contract_review_fact_chunk_v1 -> stage_contract_review_facts_v2`。最终 checkpoint 与 v2 staging 均通过，数据库保存的 `source_exact_text` 仍是源文件逐字文本；重复 quote、重叠重复 `aaaa/aaaaa` 和非空白改写继续被 helper 拒绝。脚本为 `output/evidence/g5-v12/g5-067-whitespace-stage-transaction-probe.sql`。
- 探针先暴露两个夹具约束（合同号唯一、ReviewRun 前必须已有 current page map），均在失败事务中自动回滚；进入真实 staging 后又发现现有 SQL 把 `matched_levels=[]` 的三个 `false` 与 `NULL` 比较，导致合法 `default_unknown_yellow` 永远被拒绝。`068` 向前改为把空匹配显式视为三个 `false`；首次写法误把 SQL 特殊表达式限定为 `pg_catalog.coalesce`，随即由 `069` 向前修正，没有改写已应用迁移历史。
- 069 后同一完整事务探针通过并 ROLLBACK。残留复核为临时 contract/job/invocation/adjudication 全 0；anon 对 v1、authenticated 对 v2 均不可执行，service role 的 v2 可执行；最终函数包含 3 个合法 `coalesce(v_matched_level = ..., false)`，无错误限定写法。整个过程没有模型、Storage 或 Production 调用。
- 4 个目标文件 103/103 测试、`pnpm exec tsc --noEmit --incremental false` 通过；排除 `.env*`、`output` 与旧 `.next` 的隔离 Next.js 14.2.35 build 也完成 81/81 页面。构建只保留既有 3 条 review 页面 lint warning、Sentry 动态依赖 warning 与动态 API 预渲染诊断，退出码为 0。068/069 只替换既有 service-only 函数体和重申 ACL，不建表、不迁移数据、不引入付费依赖。
- 这关闭的是“确定性 enum 错误不重试、空白锚点 checkpoint 到 staging、空匹配默认黄灯可落库”的 Preview 门禁；没有重跑失败的真实合同，也没有生成新的盲测分数。因此真实候选历史状态仍是 runtime failed，blind accuracy 未评估，release=false。下一步是先锁定全新人工金标合同小集，再运行新的代表性合同；不得把事务探针当作法律准确率或发布验收。
- 盲测库存只读盘点进一步证明当前不能直接开跑：Preview 共保留 7 份合同，5 份有解析文本但全部已有 invocation，另 2 份未被模型看过却无解析文本；仓内 45 个 Word/PDF、42 个唯一哈希全部位于 `output/`，其中 32 个是导出/批注派生物，其余 13 个也是受控、合成、已使用或没有独立真实合同金标。当前 `eligible_contracts_now=0`，详见 `output/evidence/g5-v12/g5-real-blind-corpus-inventory-20260718.json`。因此没有为制造进度而再跑模型。

### 0.1 三个生命周期与 Session 边界

为停止长对话造成的跨阶段回改和验收循环，`WP01-WP09` 从本版起按三个生命周期执行：

| 生命周期 | 目标范围 | 当前 Session 是否开发 | 退出条件 |
|---|---|---|---|
| 第一阶段：底座 | WP01-WP03，平台 AI 配置、真实模型运行、规则资产产品化 | 否，已完成本地交接 | WP01-WP03 联合回归、证据归档、未决风险和第二阶段交接包齐全后，立即停止当前 Session |
| 第二阶段：业务 | WP04-WP07，合同入口、审核批注、文档对比、合同起草 | 是，但当前仅 WP06 允许执行 | 合同全生命周期按浏览器/API/数据/DOCX/PDF 证据验收 |
| 第三阶段：表现层 | WP08-WP09，品牌组织交互、UI、工程、部署 | 否，新 Session 单独执行 | 桌面/iPad、构建、Production Ready 和线上复验通过 |

当前进度：`WP01-WP04 本地开发验收完成 -> WP05 文件矩阵与运行底座有证据但因外部金标缺失以 NO-GO 停靠 -> WP06 唯一 Active -> WP07 Next`。WP01-WP06 仍需在 WP09 统一完成 Production 复验，因此这里的“完成”不是整批线上关闭。

已满足的第一阶段退出门禁（历史交接依据）：
- WP01-WP03 的实现、数据迁移、API 和浏览器证据均可复现。
- 本地模型、云模型、规则兜底的真实状态和失败原因可见，不能用配置快照冒充运行证据。
- 规则库、规则项、转译/测试/发布包形成从配置到执行的闭环。
- 记录未决风险、已知限制、数据库状态、测试命令和第二阶段依赖，不把问题带入下一 Session 后重新发现。
- 已形成第二阶段交接并切断第一阶段 Session；该条仅记录历史退出事实，不再约束当前 WP06 Session。

本账本已经在主文档顶部设置显性入口：`product-truth/00-master/PROJECT-主文档.md#当前执行目标入口2026-07-16`。如果目标没有出现在该入口、本文件和当前调度状态中，就不能算已更新。

2026-07-14 第一阶段收口：目标账本升级到 `v2026-07-14.01`。WP01-WP03 已完成本地实现、真实调用、数据迁移、构建及桌面/iPad 浏览器验收；第二阶段 WP04-WP07 的交互硬约束已写入 `F005v2`。计划面板负责执行可见性，本文件负责验收标准和证据留存；二者不一致时，以本文件和主文档入口为准。

Codex active goal 目前只显示合同产品线总目标，不展开 `WP01-WP09`。因此当前真实执行目标以本文件、主文档入口和计划面板的 `WP01-WP09` 为准；active goal 只作为承载本轮工作的总目标外壳，不作为逐项验收账本。

本文件中的 `WP01-WP09` 是总目标集合；本独立 Session 的 `WP06 + WP06 退出门禁` 已完成 Preview 候选收口，调度暂保留 WP06 的关闭态，防止无目标空档被新输入抢占。WP05 已停靠，WP07 是 Next，WP08-WP09 只作为 Ready；后续任何开发、测试、提交、部署都必须先挂到对应生命周期和唯一 Active，WP07 未建立自身结构化目标与允许路径前不得开始实现。

本阶段真实目标不是“修几个页面”，而是先把合同产品线跑成可验收闭环。集成线（纷享销客免登录、外部组织同步）先做方案和接口准备，不混入本轮产品线关闭条件。

2026-07-13 本轮目标重写口径：先收产品线，再收集成线。产品线必须同时覆盖平台级 AI 能力底座、规则资产、合同中心入口、合同审核、合同对比、合同起草、品牌与组织交互、工程分支与线上验收。任何目标如果只完成“页面看起来变了”，没有真实模型调用、真实规则数据、真实 DOCX/PDF 文件、真实浏览器和线上证据，都保持未完成。

第二阶段产品顺序仍为：`WP04 合同中心入口 -> WP05 审核与源文件批注 -> WP06 文档对比 -> WP07 合同起草 -> 第二阶段退出门禁`。本次不是宣称 WP05 完成，而是因合格外部金标为 0，经影响评估和用户批准将 WP05 以 NO-GO 停靠；WP06 已达到 Preview 退出门禁并保持关闭态，WP07 只有在独立目标、范围和验收合同写入调度后才能接替 Active。

最新 9 个真实目标如下。状态分成“开发验收状态”和“整批 Production 门禁”：子目标可以在本地证据齐全后结束开发，但只有 WP09 的线上回归通过后，整批目标才算最终关闭。这里把上一版混在一起的 AI 能力拆成两张目标卡：`WP01` 管“怎么配置”，`WP02` 管“是否真实运行并留下证据”。合同中心只保留三条产品线入口：合同起草、合同审核、合同文档对比；继续审核、查看批注、再审核、对比结果都只能作为任务状态动作，不再作为一级入口混淆产品边界。

| 目标卡 | 最新目标 | 当前真实状态 | 关闭条件 |
|---|---|---|---|
| WP01 | 平台 AI 配置底座 | 本地验收完成，待 WP09 线上复验 | 配置中心拆成 Provider 配置、模型应用、工具消费配置三层；Provider 支持供应商、官网、API Key/认证字段、Base URL、API 格式、模型列表与映射、JSON 扩展；模型应用支持 system prompt、Agent/计划、默认策略；工具消费支持合同审核、标书/长文档、合同对比解释、合同起草、批注生成等场景配置 |
| WP02 | AI 运行真实性与路由证据 | 第一阶段本地开发验收完成，待 WP09 线上复验 | 本地 LM Studio、云端 OpenAI-compatible、规则引擎都能真实 probe；策略可按任务、长度、格式、敏感级别选择模型并降级；ReviewRun 写入 `model_invocations`，可看到 provider/model/phase/token/status/degraded/error；复审可指定本地、云端或策略，而不是反复等待错误兜底结果 |
| WP03 | 规则资产产品化 | 第一阶段本地开发验收完成，待 WP09 线上复验 | 配置中心以“规则库树 -> 规则详情”维护规则；规则库/规则项可增删改查；规则详情只保留可执行结构：ID、名称、状态、触发器、判定器、红绿灯、证据、输出动作、测试结果；发布生成 SkillBundle |
| WP04 | 合同中心入口与任务识别 | 本地开发验收完成，待 WP09 线上复验 | 首页入口顺序为合同起草、合同审核、合同文档对比；任务卡明确标注模块、v 几版本、当前状态、下一步，不再让用户猜这是审核、对比还是起草 |
| WP05 | Word/PDF 多格式源文件批注闭环 | `NO-GO / waiting_external_gold`，已停靠 | 保留“客户已同意 / 客户有反馈 / 要求特批”谈判闭环；DOC/DOCX/DOCM 与文本/扫描 PDF 使用统一页级批注模型；Word 预览显示已有修订/批注；DOCX/DOCM 在源文件副本上增量写原生批注并保持宏资产，PDF 在源 PDF 副本上写标准 annotation；恢复前必须先有全新源文件和事前独立人工金标 |
| WP06 | 文档对比闭环 | Preview 可审计候选已完成，待 WP09 Production 复验 | 旧/新文件在创建时冻结不可变源身份、SHA、文本和页映射；浏览器高还原预览支持缩放、适宽、独立/同步滚动、双侧差异定位；真实 DOCX 报告带双侧原文/位置/SHA；组织隔离、Preview/桌面/iPad/真实文件验收通过 |
| WP07 | 合同起草闭环 | Next | 需求生成可编辑 Word 草稿；标记草稿版本；支持 DOCX 导出，并可转审核或转对比；预览不能只是网页文本或不可编辑 PDF |
| WP08 | 品牌主题与组织交互 | Ready，不是当前 Active | BrandProfile 统一 favicon/logo/title；主题只管颜色/圆角；logo 比例符合浏览器/侧栏/登录页常规规范；组织长列表、主管选择等控件可滚动可操作 |
| WP09 | 工程、分支与线上验收 | 未完成 | 分支收敛清楚；本地测试、构建、桌面/iPad 浏览器验收通过；用户要求后提交推送，Vercel Production Ready 后才算线上可验收 |

这 9 个目标才是后续关闭标准；下面的详细表只负责展开每个目标的页面/API、失败标准和证据位置。

---

## 1. 这份账本解决什么问题

本文件不是新的 PRD，也不替代 `F005v2 / F009 / F012`。它只做一件事：把当前 9 个执行目标集中成可验收目标卡，避免目标散落在对话、截图和临时说明里。

当前真实结论：截至 2026-07-18，WP01-WP04 已完成本地开发验收；WP05 的文件矩阵、运行证据与确定性恢复机制已保留，但真实候选历史运行失败、盲测准确率未评估、发布为 false，且当前合格外部金标库存为 0，因此经用户批准以 `NO-GO / waiting_external_gold` 停靠。WP06 已完成免费 Preview 可审计候选：创建时双源快照、组织隔离、双侧位置、DOCX/PDF 高还原双栏、可控交互和真实 DOCX 报告均通过 API、数据库、桌面/iPad、真实文件与清理验收；Production 仍待 WP09 复验。增量费用为 0，Production 始终只读；未 push、未创建 PR、未部署。WP07 只是 Next，建立自身结构化目标与允许路径前不得自动切换 Active。

本次最新修订补充三条边界：
- 不是全盘否定现有设计；保留有价值的 Provider、降级、超时、规则树、版本流基础，但必须把配置、应用和工具消费拆清楚。
- AI 不是合同审核的私有配置页，而是平台级能力底座；合同审核、标书解析、长文本、起草、对比解释都只是消费方。
- 规则集不是给人读的长表单，也不是黑盒 Markdown；规则资产必须以树结构进入具体规则项，并能清楚表达触发器、判定器、红绿灯、证据和输出动作。

完成目标不能只看“代码有修改”。每个目标必须同时满足：
- 页面或 API 行为可复现。
- 数据、文件或模型调用有证据。
- 桌面和 iPad 关键路径可验证。
- 线上不能验收时保持未完成。

---

## 2. 当前 9 个目标

| 目标卡 | 状态 | 业务目标 | 涉及页面 / API | 验收动作 | 失败标准 | 证据位置 |
|---|---|---|---|---|---|---|
| WP01 | 本地验收完成，待 WP09 线上复验 | 平台 AI 配置底座：Provider 配置、模型应用、工具消费配置三层分离 | `/configs?tab=ai`、`/api/configs/ai-models`、`/api/configs/ai-runtime` | Provider、模型应用、工具策略三类发布对象分别为 3/4/7；7 个工具均能解析到应用、策略和 Provider 链；桌面与 iPad 无页面横向溢出 | 三类对象仍混杂；工具找不到应用/策略；L1/L2/L3 被当成底层模型写死；运行时读取草稿而不是发布版本 | `F012`、`output/playwright/g1-ai-config-20260713/`、运行时 API 返回 |
| WP02 | 第一阶段本地开发验收完成，待 WP09 线上复验 | AI 运行真实性与路由证据：多模型可配、策略匹配、降级、token/cost 记录 | `model_invocations`、`/api/contracts/[id]/review`、模型路由代码 | 本地 LM Studio、云端 OpenAI-compatible、规则引擎都能真实 probe；策略按任务类型、文本长度、文档格式、敏感级别匹配模型；复审可选本地、云端或策略；真实 ReviewRun 写入 provider/model/phase/token/status/degraded/error | 只保存草稿配置、没有真实调用；规则引擎冒充 AI；复审只能重复跑错误兜底；没有 token/cost/降级证据 | `model_invocations`、ReviewRun、浏览器模型证据区 |
| WP03 | 第一阶段本地开发验收完成，待 WP09 线上复验 | 规则资产产品化：规则库树、规则项 CRUD、结构化触发器、规则测试、发布包 | `/configs?tab=rules`、`/api/contract-policies/rule-sets`、`/api/contract-policies/rules` | 规则库/规则项可增删改查；交互从“规则库树”直接进入“规则详情”；详情只保留 ID、名称、状态、触发器、判定器、红绿灯、证据、输出动作、测试结果；测试能说明命中原因 | 规则表单仍是长说明、按钮不可用、字段给人看但机器不用、UI 读旧表但引擎读新表 | `F009`、规则 API 返回、浏览器验收 |
| WP04 | 本地开发验收完成，待 WP09 线上复验 | 合同中心入口与任务识别：起草、审核、对比三条产品线清晰分离 | `/contracts` | 入口顺序为合同起草、合同审核、合同文档对比；任务卡显示模块类型、版本号、当前状态和下一步 | 继续审核/查看批注/对比混成主入口，任务无法识别 v 几版本 | `lib/contracts/task-model.test.ts`、`output/playwright/g4-contract-center-desktop.png`、`output/playwright/g4-contract-center-ipad.png` |
| WP05 | `NO-GO / waiting_external_gold`，已停靠 | Word/PDF 多格式源文件批注闭环：高还原预览、谈判决策草稿、批量复审、源副本增量交付 | `/contracts/[id]/review`、`/contracts/[id]`、`/api/contracts/[id]/export` | DOC/DOCX/DOCM/PDF 均可进入页级工作台；Word 已有修订/批注在预览可见；扫描 PDF OCR 失败不阻断人工批注；DOCX/DOCM/PDF 从不可变源文件副本增量生成原生批注版；DOC 导出明确要求先另存为 DOCX | 用近似 HTML 冒充原文；从预览 PDF 重建 Word；覆盖既有修订/批注；宏被执行或清除；DOC 静默转格式；只有网页高亮却没有原生交付文件 | 含既有修订/批注的真实 DOCX、真实 DOCM、DOC 预览、文本/扫描 PDF；目标测试；桌面/iPad；Word（WPS 可选）/至少两种 PDF 阅读器 |
| WP06 | Preview 可审计候选已完成，待 WP09 Production 复验 | 文档对比：上传优先、原文预览、差异定位、独立/同步滚动、报告导出 | `/contracts/compare`、`/contracts/[id]/compare`、compare API | 旧/新文件明确上传或选择；版本只作为属性辅助；PDF/DOCX 在浏览器端最大程度按页、条、款还原；支持缩放、单独滚动、同步滚动、页码定位和差异报告导出 | 只能看失真文本卡片、File not found、不能缩放、不能导出报告、左右文件角色不清 | Compare API、浏览器截图、导出报告 |
| WP07 | 未完成 | 合同起草：从需求生成可编辑 Word 草稿，并能导出/转审核/转对比 | `/contracts/draft`、草稿导出 API | 输入需求后生成可编辑合同草稿；标记草稿版本；可导出 DOCX 并进入审核或对比 | 只生成网页预览或 PDF，不可继续 Word 工作，没有导出入口 | DOCX 草稿、浏览器验收 |
| WP08 | Ready，不是当前 Active | 品牌主题与组织交互：BrandProfile 统一 logo/favicon/title，组织控件可用 | `/configs?tab=theme`、`/configs?tab=org-structure` | 主题只管颜色/圆角；品牌资料统一 logo、favicon、标题；logo 比例符合常规浏览器/侧栏/登录页规范；部门主管选择可滚动 | 浏览器 favicon 与品牌不一致、主题里重复配置 logo、长列表无法滚动 | BrandProfile 数据、HTML head、浏览器截图 |
| WP09 | 未完成 | 工程、分支与线上验收：分支收敛、测试、构建、浏览器、部署闭环 | 本地、GitHub、Vercel | 分支合并策略清楚；`pnpm tsc --noEmit`、`pnpm build`、关键测试、桌面+iPad 验收；用户要求后提交推送并等 Production Ready | 本地看起来能跑但线上不可验、未构建、未浏览器验收、分支状态混乱 | 命令输出、Vercel Production、线上截图 |

---

## 3. 当前真实进度

### 3.0 第一阶段最新验收快照（覆盖下方历史增量描述）

- **WP01**：Provider、模型应用、工具消费配置已经分层；7/7 工具可解析到已发布策略与 Provider 链。桌面/iPad 页面、运行时 API、类型检查与路由单测通过，待 WP09 做线上复验。
- **WP02（历史第一阶段环境，与当前隔离 Preview 分开）**：同一真实合同 `13aca6c2-e902-4458-9e94-6d8db8ae7a09` 曾分别生成本地模型、云模型、规则引擎三次 ReviewRun。证据为：本地 `12f346ee-011b-4d26-be84-d1d5593a44ef`（630/471/1101 tokens，非降级）、云端 `922d9a9c-0d0a-4068-b304-c0565c0ae3e2`（5062/1125/6187 tokens，非降级）、规则兜底 `a1918c45-fbc8-494d-9b82-a475dd7453db`（215ms，明确 degraded）。2026-07-17 隔离 Preview 又新增了同一受控 Word 源上的 Qwen/Gemma 两条本地模型 ReviewRun；新旧环境 ID 不混用。
- **WP03**：运行规则源已收敛到 `contract_rules_v2`；浏览器读取 14 个规则集、15 条规则、15 条已发布资产；规则集/规则项 CRUD、真实模型测试、确定性测试和发布门禁可用。生产发布函数只允许 service role 调用，发布必须有晚于规则修改时间的通过 eval；当前正式包保持 `CONTRACT_REVIEW_DEFAULT v18`，本轮没有伪造新发布版本。
- **联合工程证据**：规则资产相关 46 个 Vitest 用例通过，`pnpm tsc --noEmit` 通过，`pnpm build` 通过；桌面与 iPad 截图为 `product-truth/product-code/output/playwright/g3-rules-desktop.png` 和 `g3-rules-ipad.png`。
- **未转移为完成的风险**：Geist 字体 404 归 WP09；空的“默认规则集”属于待用户确认的数据噪音，不自动删除；历史 public 合同表 RLS 缺失是独立安全债务，不能在没有策略设计时直接批量开启。

### 3.1 第二阶段启动交接包（WP04-WP07）

第二阶段只消费第一阶段已发布的 AI 运行策略和规则资产，不重新设计 WP01-WP03。执行顺序固定为 `WP04 入口与任务识别 -> WP05 审核与源文件批注 -> WP06 文档对比 -> WP07 合同起草`，每张目标卡独立完成浏览器、API、数据和文件验收后才能进入下一张。

WP05 的实现必须同时满足以下业务边界：

- 不重构掉历史有效的谈判闭环：`客户已同意 / 客户有反馈 / 要求特批 -> 批量提交 -> 重新审核 -> 导出源文件批注版` 是刚需；AI 对话只是可折叠辅助。
- 页面采用风险导航、源文件主轴、策略执行轨道三轴联动；`15/55/30` 是桌面响应式基线，不是固定像素，也不依赖跨栏绝对坐标。
- 风险事实与销售决策分离。点击策略只无刷新写入 `DRAFT_SELECTED` 草稿并更新批注预览，不创建 ReviewRun；是否自动进入下一条由用户控制。
- 批量提交前执行跨条款冲突检查，提交后才创建新的 ReviewRun。未处理风险不得静默视为通过。
- 策略、谈判底线和批注模板来自 WP03 已发布规则版本。AI 只能根据原文证据、已选策略和法务模板转译客户侧措辞，不能自行决定处理结论。
- Word/PDF 原件是不可变事实源：网页层只保存结构化批注意图；DOCX/DOCM 在源包副本上增量写原生 Word 批注，PDF 在源 PDF 副本上写标准 annotation。DOC 仅保留原件和预览，生成 AI 批注版前要求另存为 DOCX。扫描 PDF 没有文本层时使用区域/位置锚点；不得从预览 rendition 重建交付物、重排源材料或泄漏内部规则、模型、UUID 和定位字段。
- 50 页长合同必须支持页码/条款锚点、风险分布轨、可关闭聚光灯和键盘跳转；iPad 必须保持源文件与策略轨道并行。

恢复 WP05 前必须读取当前版 `F099`、`F005v2` 第 1.3/1.4、2.2/3.3 节、`F009` 和 `F012`，并先补齐全新源文件与事前独立人工金标。WP05 当前保持 `waiting_external_gold`，不得因本节的历史交接文字自动切回 Active；WP06 已完成 Preview 候选收口，WP07 仍须建立独立结构化目标后才能激活。

### 3.2 第二阶段执行证据（2026-07-14）

本节下方 v04-v16 的合同、ReviewRun、批次、任务和调用记录 ID 多数是历史第一/第二阶段环境证据，不属于 2026-07-17 新建的隔离 Preview；当前 Preview 的新证据以 v17/v18、`preview-runtime-fixture-20260717.md` 和 `preview-file-matrix-20260717.md` 为准，不再是零调用或零文件状态。

- **WP04 本地开发验收完成**：`/contracts` 一级入口严格为“合同起草 / 合同审核 / 合同文档对比”；继续审核、查看批注和对比结果只存在于任务内部。任务卡读取持久化 `contract_versions.version_number` 和来源，不用列表序号伪造版本；模块、版本、状态、下一步均可见。领域测试 `lib/contracts/task-model.test.ts` 通过；桌面和 iPad 证据为 `output/playwright/g4-contract-center-desktop.png`、`output/playwright/g4-contract-center-ipad.png`。WP04 保持“待 WP09 线上复验”，不在第二阶段提交或部署。
- **WP05 双层决策与并发门禁**：法务策略快照与谈判结果分别持久化；`customer_feedback / exception_requested` 可在未选策略时形成 `DRAFT_READY`，但必须填写反馈/特批依据；`customer_agreed` 必须有已发布可执行策略。PUT 接收 `expected_version` 并以 `id + optimistic_version` 更新，旧版本返回 409。策略静默乐观暂存，无成功 toast；自动下一条只在草稿完整时触发。
- **WP05 提交与冲突 API**：完整 10 风险批量提交在约 9 秒内返回 `202/queued`，批次 `a2ae31b9-6db8-4e27-b05e-7a6a5dc7f9ed`、新 ReviewRun `0871c19c-fee7-4791-ad68-32afbcc2782c`、持久任务 `ddc50a52-a992-4d92-a66e-5cdd45d8bc22`；模型不在提交请求中同步等待。页内定位和动作坞修正后，8 个待处理草稿再次以 `202/queued` 创建批次 `e65e19d1-75bd-45a6-af63-613a074590bd`、ReviewRun `01f4ff46-fb95-465c-8b97-8f3847cb9b04`、任务 `57e90722-2859-42cc-9b78-d0d8a5405ff3`。显式 `consistency_key/conflict_group` 冲突返回 409，冲突批次 `7b8b1592-a4ee-4563-952a-934787e9a702`，页面可分别回跳两处风险证据；没有配置时不按标题或同 rule_code 猜冲突。
- **WP05 真实模型与逐风险结果**：最新 worker 使用 `local_primary / google/gemma-4-e4b`，调用记录 `fb2d67e7-d3db-4c9b-be2b-e34e31585766` 为 `completed`、`degraded=false`、延迟 60781ms。最新 ReviewRun 的 10 个风险逐项输出 `2 resolved / 1 still_open / 7 needs_revision`，风险状态为 `2 fixed / 8 open`；上一轮已通过且未提交新结论的 2 项保持 resolved，客户反馈为 `still_open`，特批和缺安全客户侧输出的项保持 `needs_revision`。`worker completed` 没有被等同整批通过，并为 8 个未通过风险创建可重试草稿。
- **WP05 页内条款定位与 50 页浏览器**：真实样本 `output/evidence/g5/g5-50-page-10-risk-sample.docx` 及对应 PDF 均为 50 页。服务端用 `pdftotext -bbox-layout` 从真实渲染 PDF 提取行框，将行文本重新绑定到不可变 source offsets，并持久化 50/50 页、304 个真实行框；最新审核 API 的 10/10 风险均返回 `source_anchor.precision=line` 和可渲染百分比矩形。点击 R009 后中栏显示真实第 10 页 `PAGE-10-ANCHOR-10`，6 个行框叠加在 PNG 原文上并滚动到可视区垂直中心，桌面中心误差为 0；右栏同时切到 R009。若某文件无法生成行框，接口保留 `precision=page/provisional`，UI 明确显示人工定位，不伪称精确高亮。连续处理 10 条、撤销/刷新恢复、已配置冲突回跳、页级懒加载、J/K 键盘跳转、可关闭轻量聚光灯均已验证。桌面证据 `output/evidence/g5-browser/review-workbench-line-highlight-feedback-no-strategy.png`、冲突回跳证据 `review-workbench-configured-conflict-jump.png`；iPad 横屏/竖屏证据为 `review-workbench-line-highlight-ipad-landscape.png`、`review-workbench-line-highlight-ipad-portrait.png`。两种 iPad 方向均保持源文档与当前策略并行，resize 后行框中心误差为 0，固定动作坞始终在视口底部。
- **WP05 反馈/特批先于策略的真实门禁**：R009 在页面无选中策略时记录 `customer_feedback` 和必填反馈，动作坞可用；实际 PUT 后数据库为 `resolution_strategy_id=null / workflow_state=DRAFT_READY / optimistic_version=2`，source anchor 为第 10 页、`precision=line`、6 个行框，并成功进入批次 `e65e19d1-75bd-45a6-af63-613a074590bd` 的异步复审。`customer_agreed` 仍在上方结果按钮和底部动作坞两处要求策略；选择 Option 只暂存法务策略，不会暗中写入客户已同意。
- **WP05 发布 Option 证据**：最新 API 直接读取 v18 发布规则快照，Option 同时返回 `label / description / action_type / negotiation_guidance / bottom_line / comment_template`；R009 实测 `action_type=auto_accept` 且其余五项均非空。没有规则证据绑定时不生成正式 Option。
- **WP05 DOCX/Word**：浏览器真实导出 `output/evidence/g5/g5-50-page-10-risk-sample-annotated-final.docx`。ZIP/OOXML 校验通过，2 个逐风险通过项对应 2 个原生批注，`commentRangeStart / commentRangeEnd / commentReference` 一一匹配；`styles.xml / settings.xml / numbering.xml` 与源文件字节一致，未出现 UUID、rule_id、规则快照、source range、model log 或 Word 操作指令。Microsoft Word 已从磁盘全新打开，显示“第 1 页，共 50 页”和 2/2 批注线程。受控修订专用证据 `controlled-revisions-comments-proof.docx` 包含唯一 `w:id` 的修订与原生批注，且页眉、页脚、样式、设置保持不变。
- **WP05 测试证据**：`pnpm vitest run lib/contracts/task-model.test.ts lib/documents/source-render.test.ts lib/contracts/review-workbench.test.ts app/api/contracts/[id]/review/decisions/[riskId]/route.test.ts app/api/contracts/[id]/review/submit/route.test.ts app/api/contracts/[id]/analyze/route.test.ts` 为 6 文件、29 用例通过；`python3 -m unittest lib/export/test_word_generator.py` 为 2 用例通过；`pnpm tsc --noEmit` 通过。
- **WP05 2026-07-17 新硬门禁**：WPS 不再是方案依赖。WP05 必须证明含既有修订/批注的 Word 在审阅预览中可见，DOCX/DOCM 导出保留既有内容并新增原生 AI 批注，PDF 输出为标准 annotation，扫描 PDF 无文本时仍能人工批注。legacy DOC 同格式写回不再是 WP05 关闭条件，但 UI/API 必须明确要求先另存为 DOCX，不能静默转换。
- **WP05 v06 本地候选事实**：在 v05 的多格式导出和三元源身份上继续收口了执行链。直接请求与队列恢复复用同一结构化 Worker；启动恢复使用本次唯一 request id，并同时匹配策略、Provider 与源身份；确定数据库错误不再触发恢复。候选迁移加入租约 fencing、原子 stage/complete/fail、源摘要复核、风险事实冻结、旧 active job 清零门禁，以及旧 ReviewRun/已提交草稿不可重开的数据库约束。浏览器复审刷新改为轻量状态接口、指数退避且最多 8 次/120 秒；页图只保留当前页及相邻页，当前页失败、自动下一条和 iPad 可用高度的假阻断已修。Python 文件导出测试为 9/9 通过，当前 30 个 WP05 范围 TS/TSX 文件通过语法转译，SQL 静态检查为 42 个 dollar-quote 分隔符、18 个函数、无重复函数名，`git diff --check` 通过。完整 Vitest、typecheck/build、SQL 实际执行、浏览器和真实文件验收尚未完成，因此仍是本地候选，不是可发布版本。
- **WP05 v07 冻结溯源与并发收口**：ReviewRun 在启动时冻结唯一规则包、模型策略和规则/规则集快照；风险查看、单项决策与批量提交只读该历史版本。AI 标题、说明和建议不再冒充锚点，只有当前源文本中唯一逐字 `source_quote` 可形成 exact anchor；只有 rule_code 的结果保持 unbound，不生成客户法务 Option。单项决策改用原子 RPC，与批量提交首先串行同一 contract/page，关闭跨标签页死锁；直接风险的租约、来源、UTF-16 锚点、唯一原文和服务端时间由 SQL 再核验。exact request 恢复已覆盖 queued/running/completed/failed 三表一致状态，队列抢先获取租约时即时请求不再覆盖其正常运行。
- **WP05 v07 本地验证**：使用同版本、只读且完整的依赖树，非 E2E Vitest 为 62 文件/406 用例全部通过，422 个 TS/TSX 源文件严格语义检查通过，Python Word/PDF 文件测试 9/9 通过。候选 SQL 静态结构为 50 个 dollar-quote 分隔符、22 个函数、3 个 DO block、无重复函数名。当前 `node_modules` 导入链不完整，Next build 仍未完成；SQL 静态结构也不是迁移执行证据。
- **WP05 v08 当前依赖与构建门禁**：隔离闭包中的全部直接依赖与当前 lock importer 为 0 版本错配、0 断链；因本机 pnpm 10 会重建 pnpm 9 布局，使用保留的 pnpm 9.15.9 校正差异，并从 npm 官方精确版本恢复 3 个小文件密集包，3270/3270 文件与 pnpm store SHA-512 一致。Next.js 14.2.35 build 退出码 0、静态页 81/81；`tsc --noEmit`、Vitest 62 文件/407 用例、Python Word/PDF 10/10 通过。构建保留 3 条既有 review 页面 lint warning 与动态 API 预渲染诊断，但均未阻断编译、类型检查或产物生成。
- **WP05 v08 PDF/DOC 文件级门禁（历史）**：真实 Image XObject、无文本层的扫描 PDF 在原图保持的前提下写入 1 个 Highlight 与 2 个 Text annotation；同一输出在 macOS Preview 与 Safari 均读取到完整中文区域/点批注，Chrome 也显示高亮与备注图标。当时 `.doc` 路由使用 `DOC_ADAPTER_NOT_PROVEN` 关闭假支持；v13 已将其替换为稳定产品边界 `LEGACY_DOC_REQUIRES_DOCX`。
- **WP05 v09 DOCM 初步门禁（已被 v10 加固）**：v09 首次关闭了“普通 DOCX 改名 `.docm` 时空宏哈希集合也能通过”的假成功，并完成 Word/Apache 两类真实文件往返；随后独立复审发现只看 CFB 头、relationship basename、缺少 `vbaData` 闭环和 ZIP 重名/资源攻击仍会产生假阳性，因此 v09 不能单独作为当前关闭依据。
- **WP05 v10 DOCM 加固候选（已被 v11 收口）**：v10 加入 ZIP 资源门禁、Content-Type Override 优先、精确 VBA/vbaData 关系和 `olefile` OLE stream 检查；独立复审随后继续复现“核心 VBA streams 原长度清零”“缺 package root 关系”“孤立 VBA Content-Type”“非 XML vbaData”“孤立 relationship source/target”“未声明 Content-Type”“大小写等价 Override 冲突”和“伪主文档”等管线假阳性，因此 v10 的 18/18 只保留为发现过程，不能作为当前关闭依据。
- **WP05 v11 受支持形态 DOCM 文件门禁**：输入与输出同时验证 ZIP entry 数/大小/压缩比/加密/压缩方式/路径/重名；每个实际 part 必须有有效 Content-Type，Override 按 OPC 大小写等价唯一且精确指向实际 part；每个 relationship part 必须位于规范 `_rels` 位置，非根 source 与 Internal target 必须存在，relationship 不得以 package metadata 为 source/target；package root 必须唯一内部指向 `/word/document.xml`，主 XML 根必须为 `w:document`。存在 VBA Project 时再由 `olefile==0.47` 与 `oletools==0.60.2` 静态解压解析 `PROJECT`、固定 `_VBA_PROJECT` 头、`VBA/dir` 和所有 module streams，并闭合唯一 `vbaData` XML/关系；宏启用但零 VBA Project 的合法文件明确返回 `macro_project_present=false`。检查依赖缺失或任一不变量失败均 fail closed，未修改 ZIP part 采用流式复制。
- **WP05 v11 可复现证据**：固定 Apache POI `SimpleMacro.docm`（commit `4554f204cbbf00ecbcaed134fe57e43a1779a612`，Git blob `123b8157f3dacb7fb678460a35e57315d0777c94`）和 Microsoft Word 16.111 生成的真实 DOCM 均只做静态解析与批注写入，未执行宏；最新 Word 输出保留 `WP05-DOCM-REAL-MACRO-ANCHOR`，`vbaProject.bin`、`vbaData.xml`、`vbaProject.bin.rels` 三项哈希逐项不变，Word 从磁盘显示 `1/1` 原生中文批注。源/输出/截图 Base64、SHA-256、Word 观察和未证明边界已归档在 `product-code/output/evidence/g5-v11`。全新 venv 按 `requirements.txt` 安装后，`pnpm test:g5-file` 为 30/30。
- **WP05 v10 DOC 适配器决策证据（已被 v12 限定）**：固定 Apache POI 二进制 `SimpleMacro.doc` 的本地 LibreOffice 原型可写回同格式 DOC；正文逐字相同、渲染页逐像素相同、10 个 `Macros/...` OLE streams 字节一致，并含 1 条原生中文批注。这只能证明可信 fixture 的格式可行性；不能证明整个 Worker 隔离、转换路径宏从未执行或含对象 DOC 保真。
- **WP05 v12 DOC 红灯与 v13 决策**：固定 Apache POI `word_with_embeded.doc`（SHA-256 `206acf1f7eb7b7d2075e04015d005ae9bb56f025560f2583ad3878257bc4c7`）证明 LibreOffice 同格式往返会丢嵌入对象预览，且原型安全边界不足。该证据仍作为“为何不做 legacy DOC 同格式写回”的历史依据。2026-07-17 用户明确合同审核目标是高还原预览与源文件副本新增 AI 批注，并允许为成本限制常规格式；因此不启动 Aspose/OnlyOffice/CSPP，也不继续建设 DOC Worker。Production `.doc` 导出固定返回 `LEGACY_DOC_REQUIRES_DOCX`，原件仍保留并可预览。
- **WP05 v13 既有修订/批注与增量导出证明**：仓内 `controlled-revisions-comments-proof.docx` 含 2 个 `w:ins`、2 个 `w:del` 和 1 条既有批注；再新增一条 AI 原生批注后，修订计数保持 2/2，原批注保留，评论从 1 条增至 2 条，页眉与页脚 SHA-256 分别保持 `d139731f...` 和 `aea0d677...`。v13 的 LibreOffice 预览选择已被 v14 浏览器 OOXML 主链取代；LibreOffice 只保留为离线文件验收工具，不是 SaaS 运行依赖。
- **WP05 v14 免费 Preview 与动态 SQL 证据**：候选迁移只应用到隔离 Preview `vsfropnfsmnonkotywsx`。Storage 的 anon/auth 写入、读取和覆盖均受 RLS 拒绝，service role 的上传/下载/更新/清理通过；`contracts` 为私有 50MiB 且包含 PDF/DOC/DOCX/DOCM MIME，`contract-chunks` 为私有 4MiB。单次 3.7 秒事务回滚链通过错误源身份 `40001`、错误 lease/活动期变更 `55000`、过期回收、成功/失败幂等与 UTF-16 偏移，并在最终 ROLLBACK 后全部 fixture 残留为 0。Production 始终只读。
- **WP05 v14 浏览器 OOXML 主链**：`docx-preview 0.4.0` 仅在客户端动态加载，Word 服务端页图接口固定 422；源文件 ticket 端点先校验组织、合同、storage path、source SHA 和 text SHA，再返回 60 秒私有 Storage 地址。浏览器真实文件在桌面和 iPad 均显示 2 个插入、2 个删除与 1 条既有批注；批注具备 `tabindex=0`、ARIA 名称、点击展开与 Escape 关闭。未发生 `/source/pages` 请求或文档来源外部网络请求。证据为 `output/playwright/g5-review-ui/desktop-docx-browser-preview.png` 与 `ipad-docx-browser-preview.png`。目标测试 5 文件/23 用例、`tsc --noEmit`、Next.js 14.2.35 build 81/81 通过。
- **WP05 v15 PDF、认证与上传队列增量证据**：免费 `pypdfium2==5.8.0` Worker 已替代在当前环境整体挂起的 Poppler；文本 PDF 页图与文本抽取、无文本层扫描 PDF 渲染通过 3 个 Python Worker 用例和 8 个 TypeScript source-render 用例，随后目标测试、`tsc --noEmit` 与 Next.js 81/81 build 通过。认证依赖故障不再伪装成未登录：Supabase 查询超时或错误在 8 秒内返回 503，查无、过期或缺失 token 仍返回 401，上传页显示结构化服务端错误；认证 try/catch 与业务 handler 已分离，handler 异常只执行一次并向上抛出。多文件上传的异步完成回调改为共享唯一同步游标，同一旧回调连续完成两个文件时只从 0 推进到 1 并在第二次结束，不再反复创建第二个合同。四个目标测试文件 31/31 与 `tsc --noEmit` 通过。以上关闭代码门禁，不关闭真实 PDF 的 Preview 上传—预览—导出—阅读器链，也不替代 Preview 浏览器复验。
- **WP05 v15 免费双模型协议证据**：无需下载、账号或 API Key，直接使用机器已有 Qwen3.5-9B 与 Gemma-4-E4B 权重，通过已安装 `llama-server` 顺序调用并关闭 reasoning。对同一三条款样本，Qwen 在 14.031 秒返回 120/329/449 tokens，Gemma 在 8.624 秒返回 134/331/465 tokens；两者均为闭合 JSON、3 条风险、逐字命中的 `source_quote`，且没有伪造规则代码。证据归档于 `output/evidence/g5-v12/local-model-dual-probe-20260717.md`。该直接协议证据已被 v17 的 Preview 应用运行时闭环补强，但仍不能替代代表性审核精度测试。
- **WP05 剩余门禁（由 v25 更新）**：多格式文件矩阵、原文 canary、facts_v1 原子证据、文档级裁决、非 current 候选启动、风险物化/ReviewRun 完成、checkpoint 恢复及 `067-069` 确定性失败/空白/空匹配事务链均已有底座或受控证明；真实单合同历史运行仍在 8/13 chunk 失败，盲测准确率未评估。下一门禁是锁定全新人工金标真实合同小集并完成代表性 runtime/accuracy 验收，随后关闭合法风险决策/复审、原生 Word/PDF 导出、当前批 build、桌面/iPad、Word GUI 与 Production 发布复验。不得把受控 canary、事务探针、性能改善或历史浏览器证据冒充本批发布验收。
- **WP05 v16 上传协议与循环收口**：三个合同上传入口统一使用同一分片 Hook；服务端拒绝空文件、路径型文件名、越界/小数分块、错误边界、错误块数和超过 50MiB 的声明。每次运行使用唯一 UUID upload session，客户端和 merge 同时绑定整文件 SHA-256，临时对象路径不再按文件名共享；merge 使用单个有界输出缓冲区，并仅在 immutable source 与合同记录均成功后批量清理分块。同步 queue/run gate 阻止创建合同等待期双击；队列终态推进到 `totalFiles`；删除失败项会废弃旧合同关联；暂停复用同一 session；确定性 4xx 不重试，瞬时 5xx/429 重试有界。专项 6 文件/36 用例、`tsc --noEmit` 与 Next.js 81/81 build 通过。真实 Preview 双文件浏览器验收仍待补。
- **WP05 v17 Preview Word + 双模型真实闭环**：受控 DOCX 经真实 create/chunk/merge API 进入 Preview 合同 `6603fd5c-8d6d-4267-9e66-bee8b1e0235f`，从源 OOXML 当前正文解析 53 字，保留 `30 天 / 12 个月 / SLA` 并排除被删除的 `120 天 / 24 个月`。Qwen ReviewRun `c29bd4e1-5979-41b7-8f89-cde001667fa6` 为 328/201/529 tokens、8.856 秒、1 条逐字 SLA 风险；Gemma ReviewRun `bcfa78dd-6497-440e-8065-b0c3a3e657e9` 为 337/1528/1865 tokens、34.710 秒、3 条合理逐字风险。两者均 completed、`degraded=false`、直接关联各自 job/invocation，且源哈希与源文本哈希一致。桌面 1440×900 与 iPad 1180×820 真实页面显示 2/2 修订、1 条既有批注和风险卡，无横向溢出或 console error。随后真实两文件队列恰好产生 2 次 create、2 次 chunk、2 次 merge，两个独立合同均持久化 parsed text，最终落到第二个审核页，没有第三次循环；清理后数据库和两个 Storage bucket 残留均为 0。Preview page-map source fence 又通过源替换并发负向测试，无死锁且 fixture residue=0。bundle 仍明确 `not_release_eligible=true`，因此该证据关闭上传循环和模型基础运行前置，不关闭精度或发布门禁。详见 `output/evidence/g5-v12/preview-runtime-fixture-20260717.md`。
- **WP05 v18 Preview 多格式文件矩阵**：固定 DOCM、8 页文本 PDF、1 页无文本层扫描 PDF 均通过真实 create/chunk/merge、源 SHA/text SHA/page-map 绑定和桌面/iPad 审核页。DOCM 输出 SHA `24d21a00...`，含 1 条原生批注且 3 个 VBA parts 与源逐项同哈希；文本 PDF 输出 SHA `4051a6de...`，保留 8 页并写入 1 个 `/Highlight` 和 1 个 `/Text`；扫描 PDF 输出 SHA `96bb36f4...`，原图像流解压哈希不变并写入 1 个 `/Highlight`、2 个 `/Text`。macOS Preview 显示完整中文批注；LibreOffice 26.2.4.2 读取当前 DOCM 成功。Word 本机卡在应用自身 `_dyld_start`，当前 v12 文件的 Word GUI 门禁保持未完成。Python 3.14/lxml 与 dev hot-reload 是 60 秒假慢根因，换到免费 Python 3.11 production-mode 后 DOCM/扫描 PDF API 导出约 1.95/2.05 秒。所有 Preview fixture、Storage 对象、分块和临时 token 清理为 0。详见 `output/evidence/g5-v12/preview-file-matrix-20260717.md`。
- **WP05 v19 规则/模型精度裁定**：固定 DOCX、gold 与 v3 scorer 均用 SHA-256 锚定。最终零成本 Qwen 回归证据前缀为 `output/evidence/g5-v12/g5-50-page-qwen-v22-final-20260717T191341776Z-bfa4e861`；11/11 invocation、50,702 tokens、冻结 bundle/policy/chunk/source 身份均有效，TP42/FP4/FN3、P=.913/R=.933/F1=.923，但 severity=.833、negative specificity=.40、R004 recall=.60，门禁失败。结构问题已归零，剩余为 Level A 输出不变量、冻结规则 taxonomy/默认等级缺口和小模型一致性，不允许用同 fixture 再调 prompt。清理后目标数据库与 Storage 计数均为 0，v21 冻结资产完整保留。
- **WP05 v06 Production 阻断（历史，未执行）**：Production linked 迁移分叉与旧 Storage/RPC 风险仍作为 WP09 发布阻断；本轮没有 `db push`、`migration repair`、Production SQL、push 或部署。免费隔离 Preview 已替代在 Production 上试错，但不自动批准发布。
- **只记录到 WP08-WP09**：浏览器控制台仍有 `GeistVF.woff / GeistMonoVF.woff` 404；本阶段未修字体、品牌、组织、分支、部署问题。

下表保留阶段性事实，用于说明问题如何被发现和收敛；若与本节冲突，以本节和顶部目标卡状态为准。

| 目标卡 | 已发生的事实 | 未完成的关键缺口 |
|---|---|---|
| WP01 | 已补多 Provider 配置 schema、LM Studio 默认模板、Provider/应用/策略 UI、`/api/configs/ai-probe` 连接测试、`/api/configs/ai-models` 模型列表获取和模型映射；页面已经开始表达 Provider、模型应用、降级和工具消费。2026-07-10 v17 新增：AI 配置页顶部拆成 `Provider 配置（ccswitch） / 模型应用（Paseo / Agent） / 工具消费覆盖`；Provider 卡片显示未启用、草稿未发布、缺请求地址、缺请求模型、规则兜底、可进入运行时等状态；编辑弹窗明确草稿连接测试、发布运行策略、正式调用证据三条证据路径；能力和工具绑定增加业务说明；`策略顺位` 改为 `策略优先级`，避免把 L1/L2/L3 误解成底层模型层；本地浏览器已完成桌面和 iPad 基础验收截图。2026-07-13 v01 新增：主文档顶部入口和本账本已同步最新 `WP01-WP09`；AI 配置页在本地浏览器验证到 `Provider 配置（ccswitch） / 模型应用（Paseo / Agent） / 工具消费覆盖 / 运行时策略证据`，工具消费覆盖显示合同审核、合同对比、合同起草、标书/长文档、规则转译、批注输出、报告摘要共 7 项；运行时策略证据显示 7/7 覆盖、0 个阻断工具、首选 Provider、模型、降级链和 Token 状态；桌面截图 `product-truth/product-code/output/playwright/g1-ai-config-20260713/desktop-ai-config.png`，iPad 截图 `product-truth/product-code/output/playwright/g1-ai-config-20260713/ipad-ai-config.png`；`pnpm vitest run lib/ai/failover.test.ts lib/configs/runtime.test.ts` 通过，2 个文件、14 个用例；`pnpm tsc --noEmit` 通过。控制台仍有 `GeistVF.woff` 与 `GeistMonoVF.woff` 字体 404，归 WP09 处理 | 还需要真实 Provider 连接测试截图、发布后运行时策略 API 证据、WP02 ReviewRun 调用证据、线上验收和字体 404 收敛；没有这些不能关闭 WP01 |
| WP02 | 已有本地 LM Studio probe、OpenAI-compatible probe、`model_invocations` 记录工具和部分测试；默认 LM Studio 请求模型已从短名 `gpt-oss-20b` 改为实际可调用 ID `openai/gpt-oss-20b`；同步审核链路已开始记录 provider/model/status/degraded/token/error。2026-07-10 本轮新增：流式审核不再丢失 `tool/capability/phase`，合同审核、合同起草、通用 AI 分析、合同对话、规则语义执行、仲裁和 SmartRouter 都会声明消费工具与能力；新增 `lib/ai/failover.test.ts` 锁住按工具/能力选模型、fallback 顺序和规则引擎不冒充 AI 审核；probe 与运行时路由共用同一模型解析逻辑。2026-07-11 v18 新增：`/api/contracts/[id]/review` 的模型证据查询改为最新 ReviewRun 优先、合同维度兜底，避免真实调用记录因为 review_id 不匹配而不展示；`reviewWithFailover` 的流式路径在 stream 完成、失败或取消时补写 completed/failed 证据，避免只留下 running。2026-07-11 v19 新增：本机 LM Studio 服务已确认可达但未带 Bearer token 会返回 `invalid_api_key`，当前 `.env.local` 没有本地/云端模型 token；已修正运行时默认本地 Provider 不再伪造 `not-needed` token；配置页测试连接和获取模型列表在编辑已有 Provider 时会携带 `config_id`，服务端复用数据库中未脱敏 token 后再 probe，避免“脱敏值测试失败”误判为模型不可用。2026-07-11 v20 新增：补 `/api/configs/ai-runtime` 运行时状态接口，运行时 Provider 会区分 `ready / needs_probe / misconfigured / rule_engine`；本地 LM Studio 缺 key 只标记为需 probe，云端缺 key 标记为配置错误，规则引擎明确标记为确定性兜底且不是 AI 模型；默认本地模型修正为 `openai/gpt-oss-20b`。2026-07-11 v21 新增：AI 配置页顶部增加“运行时策略证据”区，直接显示配置来源、当前首选 Provider、降级链、每个 Provider 的状态、Token 是否配置和阻断/警告原因；`pnpm vitest run lib/ai/failover.test.ts lib/ai/provider-probe.test.ts lib/configs/runtime.test.ts` 通过，3 个文件、19 个用例；`pnpm tsc --noEmit` 通过 | 还没有完成真实合同 ReviewRun 新记录落库复验；云端 token、成本、降级链仍需真实验证；页面运行时证据还未浏览器截图验收；规则引擎还不能在审核结果页上清楚区分“AI 审核完成/降级审核完成/规则兜底”；还未完成线上验收 |
| WP03 | 规则页已开始从“中间大卡片”改成树 + 详情；规则编辑弹窗已补触发、判定、证据、输出动作字段；旧 `/api/rules` 已允许保存结构化配置；发现 UI/API/引擎表存在旧新表不一致。2026-07-10 本轮新增：单条规则 GET/PUT/DELETE 补 schema drift 兼容；规则保存/删除后改为局部刷新规则列表；规则树支持清空搜索和在当前规则集下新建规则 | 规则库/规则集本身仍不是一等对象，还是从规则字段推断；发布包、旧表到 `contract_rules_v2` 的收敛、正式规则引擎测试仍未完成；详情区仍需浏览器验收 |
| WP04 | 合同中心入口和任务标签已开始调整。2026-07-10 本轮新增：`/api/contracts` 已补充真实版本流和最近对比结果聚合，合同列表任务卡不再用列表序号伪造 `v` 版本；`/contracts` 任务卡开始区分合同审核与文档对比，并显示真实版本来源、版本数量、当前状态和下一步 | 入口顺序、任务类型标签、v 几版本和下一步仍需重新浏览器验收；线上未验收，不能关闭 |
| WP05 | 免费隔离 Preview 的安全/文件/原文链已通过；facts_v1、确定性裁决、风险物化/完成 receipt、非 current v23 候选和原子 checkpoint 已接通；受控 canary 完整通过，`067-069` 的确定性失败、空白 checkpoint→staging 与空匹配默认黄灯已通过回滚事务 | 首份新真实 DOCX 历史运行在第 8/13 chunk 失败，只有 7/13 checkpoint；尚未用新人工金标合同复验，盲测准确率未评估、release=false。仍缺代表性 runtime/accuracy、合法用户决策/复审、原生导出、当前批 build/桌面/iPad/Word GUI 与 Production 发布复验，不能发布或自动抢占后续 Active |
| WP06 | 免费 Preview 候选验收完成：不可变 old/new 双源、组织隔离、DOCX/PDF 双栏原文、缩放/适宽/独立与同步滚动、差异跳转和真实 DOCX 报告均有数据库/API/文件/桌面/iPad 证据 | Production 仍只读且未发布；线上安全与发布复验归 WP09，不回开 WP06 开发 |
| WP07 | 目标已纳入合同产品线 | 起草导出、可编辑 Word 草稿、版本流和转审核/对比仍未完成 |
| WP08 | 部门主管下拉滚动已修，通用 Select 已支持受限视口和滚动；品牌/主题边界已写入目标。2026-07-10 本轮新增：Select 通用组件和部门编辑弹窗改为固定高度上限 + viewport 滚动，不再依赖可能失效的 Radix available-height 变量 | favicon/logo 统一、logo 比例规范、主题去重仍未完成；部门主管下拉仍需浏览器和线上复验 |
| WP09 | 2026-07-10 当前局部修改已再次通过 `pnpm tsc --noEmit`；WP01/WP02 部分单测通过 | build、更多关键测试、桌面+iPad 浏览器、线上验收、分支整理仍未完成；不能用局部单测替代合同审核/对比/起草的业务验收 |

---

## 4. 更新规则

- 2026-07-13 目标可见性修正：F099 升级为 `v2026-07-13.01`，主文档顶部入口同步为 2026-07-13，Codex 计划面板重新展开 `WP01-WP09`。当前推进顺序从 WP01 开始，WP02 仅保留既有局部证据和进行中状态；没有本地构建、浏览器桌面/iPad、真实模型调用和线上验收前，任何目标都不能关闭。
- 2026-07-13 WP01 v01 局部证据：AI 配置页本地浏览器桌面和 iPad 验证通过基础可见性，页面显示 `Provider 配置（ccswitch） / 模型应用（Paseo / Agent） / 工具消费覆盖 / 运行时策略证据`；工具消费覆盖为 7 项，运行时策略证据为 7/7 覆盖、0 个阻断工具，并显示首选 Provider、模型、降级链和 Token 状态。截图在 `product-truth/product-code/output/playwright/g1-ai-config-20260713/desktop-ai-config.png` 和 `product-truth/product-code/output/playwright/g1-ai-config-20260713/ipad-ai-config.png`；`pnpm vitest run lib/ai/failover.test.ts lib/configs/runtime.test.ts` 通过，2 个文件、14 个用例；`pnpm tsc --noEmit` 通过。控制台仍有 `GeistVF.woff` 与 `GeistMonoVF.woff` 字体 404，归 WP09；WP01 仍不能关闭，因为还缺真实 Provider probe、真实 ReviewRun、云端 token/cost、降级链和线上验收。
- 2026-07-11 WP02 v21 局部证据：AI 配置页新增“运行时策略证据”区域，读取 `/api/configs/ai-runtime` 后展示配置来源、当前首选 Provider、降级链、每个 Provider 的 `ready / needs_probe / misconfigured / rule_engine` 状态、Token 是否配置和阻断/警告原因。`pnpm vitest run lib/ai/failover.test.ts lib/ai/provider-probe.test.ts lib/configs/runtime.test.ts` 通过，3 个文件、19 个用例；`pnpm tsc --noEmit` 通过。该证据只证明运行时证据已进入页面结构，不代表真实合同 ReviewRun、云端 token/cost、降级链、浏览器截图和线上验收完成。
- 2026-07-11 WP02 v20 局部证据：新增 `/api/configs/ai-runtime`，用同一套运行时 Provider 链输出 selectedProvider、providerChain 和每个 Provider 的 `ready / needs_probe / misconfigured / rule_engine` 状态，不泄漏 token；规则引擎明确输出 `rule_engine_is_deterministic_fallback_not_ai_model`，不能冒充 AI 模型；本地 LM Studio 默认模型修正为 `openai/gpt-oss-20b`；`pnpm vitest run lib/ai/failover.test.ts lib/ai/provider-probe.test.ts lib/configs/runtime.test.ts` 通过，3 个文件、19 个用例；`pnpm tsc --noEmit` 通过。该证据只证明运行时配置判定和接口路径更真实，不代表真实合同 ReviewRun、云端 token/cost、降级链、UI、浏览器和线上验收完成。
- 2026-07-11 WP02 v19 局部证据：本机 LM Studio 服务可达，但未带 Bearer token 请求 `/v1/models` 会返回 `invalid_api_key`；当前 `.env.local` 未配置 `LOCAL_MODEL_API_KEY / AI_GATEWAY_API_KEY`。运行时默认本地 Provider 已不再伪造 `not-needed` token；配置页 `测试连接/获取模型列表` 已在编辑已有 AI_CONFIG 时携带 `config_id`，服务端用数据库中未脱敏 token 合并当前草稿后再 probe，避免脱敏 token 导致假失败。`pnpm vitest run lib/ai/failover.test.ts lib/ai/provider-probe.test.ts lib/configs/runtime.test.ts` 通过，3 个文件、16 个用例；`pnpm tsc --noEmit` 通过。该证据只证明认证路径和 probe 语义更真实，不代表真实 ReviewRun、云端 token/cost、降级链、浏览器和线上验收完成。
- 2026-07-11 WP02 v18 局部证据：`/api/contracts/[id]/review` 已通过 `listModelInvocationsForContract` 改为最新 ReviewRun 优先、合同维度兜底查询模型调用证据；`reviewWithFailover` 流式路径已在 stream 完成、失败或取消时补写 completed/failed 调用记录，避免流式审核只留下 running 状态。`pnpm vitest run lib/ai/failover.test.ts lib/ai/model-invocations.test.ts lib/ai/provider-probe.test.ts lib/configs/runtime.test.ts` 通过，4 个文件、17 个用例；`pnpm tsc --noEmit` 通过。该证据只证明 WP02 的本地记录链路不再丢完成态和展示兜底，不代表真实 ReviewRun、云端 token/cost、降级链、浏览器和线上验收完成。
- 2026-07-10 WP01 v17 局部证据：AI 配置页已经拆清 Provider 配置、模型应用、工具消费覆盖和证据路径；`pnpm tsc --noEmit` 通过；`pnpm vitest run lib/configs/runtime.test.ts lib/ai/provider-probe.test.ts lib/ai/model-invocations.test.ts lib/ai/failover.test.ts` 通过，4 个文件、17 个用例；本地 Playwright 登录后验证 `/configs?tab=ai` 桌面和 iPad 页面，截图在 `product-truth/product-code/output/playwright/g1-ai-config-20260710/desktop-ai-config.png`、`product-truth/product-code/output/playwright/g1-ai-config-20260710/desktop-ai-edit-dialog.png`、`product-truth/product-code/output/playwright/g1-ai-config-20260710/ipad-ai-config.png`。该证据只证明配置页语义、类型、本地浏览器基础渲染和 AI 路由底层单测没有回归，不等于 WP01/WP02 关闭；浏览器控制台仍发现 Geist 字体 404，运行服务版本与 package.json 记录不一致，归 WP09 处理。
- 2026-07-10 WP03 局部证据：`/api/rules/[id]` 的查询、更新、删除补齐 schema drift 兼容；规则树增加搜索清空和按当前规则集新建规则入口；保存/删除后局部刷新规则列表。`pnpm tsc --noEmit` 通过。该证据只证明规则项 CRUD 稳定性改善，不等于规则资产产品化关闭。
- 2026-07-10 WP04 局部证据：`/api/contracts` 已补真实 `contract_versions` 和最近 `contract_comparisons` 聚合；`/contracts` 任务卡开始以真实数据标注审核/对比、版本、来源和下一步；`pnpm tsc --noEmit` 通过。该证据只证明任务识别底层数据和页面渲染逻辑改善，不等于 WP04 关闭。
- 2026-07-10 WP08 局部证据：`components/ui/select.tsx` 和 `DepartmentFormDialog.tsx` 已将长下拉改为固定高度上限与内部滚动；`pnpm tsc --noEmit` 通过。该证据只证明主管选择等长列表不会再靠无效变量撑出不可滚动面板，不等于 WP08 关闭。
- 每关闭一个目标，必须在本文件更新状态和证据位置。
- 目标关闭顺序允许按依赖调整，但不得跳过验收动作。
- 如果线上不能验收，即使本地代码已改，也不得把状态改为完成。
- 如果发现新问题归属到现有目标，优先合并到对应目标，不另起临时目标。
