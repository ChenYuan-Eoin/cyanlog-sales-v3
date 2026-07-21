# WP03 通用规则配置与真实审核验收

- 验收日期：2026-07-21
- 环境：隔离 Supabase Preview `vsfropnfsmnonkotywsx`；Production 数据库未写入
- 候选工作树：`Price-v3-release-20260720`
- 审计组织：`267ff216-5092-49b0-bbfb-c5881a8de207`
- 结论：WP03 的通用规则配置、原子发布、不可变快照、真实模型消费和风险决策链均已闭环；独立金标准确率仍是发布层门禁，不由本次单样本冒充完成。

## 1. 产品边界

| 对象 | 归属 | 本次合同样本中的实例 | 运行职责 |
|---|---|---|---|
| 规则集 | 系统支持的用户配置能力 | 合同审核基础规则 | 定义一组规则的统一发布边界 |
| 问题分类 | 系统支持的用户配置能力 | 金额与付款 | 用业务问题组织规则，不定义属性类型 |
| 具体规则 | 用户可新建的业务数据 | 合同金额不得低于 5 万元 | 表达要检查的问题、原因和处理目标 |
| 业务属性 | 规则详情中的通用控件 | 合同金额 / 金额 / CNY | 定义应读取的明确事实，不是独立“属性提取中心” |
| 判定与处理 | 系统支持的确定性能力 | `< 50000` 阻断；`>= 50000` 通过；缺失/冲突人工复核 | 服务端规则引擎决定风险，不让模型自行判断阈值 |
| R001-R015 | 可编辑预置业务数据 | 本验收未依赖 | 新组织即使没有预置数据，也可从空白完成同一流程 |
| Provider / Model / Route | AI 平台系统能力 | LM Studio / Gemma / local-first | 读取规则定义的属性并留下调用证据；不进入规则配置页面 |

业务页面只呈现“规则集 → 问题分类 → 具体规则 → 属性 → 判定与处理 → 验证发布”。内部规则编码、Prompt、模型路由、快照 UUID 和 Provider 细节均不作为业务人员的配置主语。

## 2. 从空白配置到发布

在新组织中通过真实浏览器完成：

1. 创建规则集“合同审核基础规则”。
2. 创建问题分类“金额与付款”。
3. 创建规则“合同金额不得低于 5 万元”。
4. 配置一个金额属性、CNY 币种、两条确定性判定和缺失/冲突处置。
5. 运行风险、通过、缺失、值冲突、单位冲突五个业务用例，结果 5/5。
6. 统一发布规则集；页面显示“线上 v1 · 1 条规则 · 验收 5/5”和“配置完整 · 已通过发布验收”。

发布事实：

- RuleSet：`d8e4c1f4-9bea-4a67-a07b-fdc5355a9ba0`
- RuleSetSnapshot：`321e217e-ba19-455c-9b20-61a1854a74dc`
- Rule：`cbcaee32-2fc8-4ee6-a516-a4790445cff8`
- RuleSnapshot：`56e7231e-067f-4ab9-bcfb-d16b05695cdb`
- SkillBundle：`abf5c05f-15c3-4088-a44e-dd7697d7f2c8`
- SkillBundle 状态：`published`、`is_current=true`、正式审核允许、规则翻译/规则集快照/规则集文档均 `ready`、规则用例 `passed`（5 个通过）

发布哈希按数据库实际保存的 JSON 计算，解决了保存时对象已被数据库规范化、浏览器仍用表单 JSON 计算哈希而造成的“看似相同但发布校验失败”。可选属性且存在 `not_exists` 判定时，不再要求一个逻辑上不可达的通用缺失用例；TypeScript、API、UI 和 Preview SQL 发布门保持一致。

## 3. 真实 DOCX 与运行闭环

真实样本 `wp03-short-real-contract.docx` 经 `python-docx` 生成、LibreOffice 转 PDF、逐页渲染检查：A4、1 页、37,944 bytes。

- 合同：`b18f949a-7194-4a7a-86b9-64938ee01fb0`
- Storage 路径：`b18f949a-7194-4a7a-86b9-64938ee01fb0/1784628581492_wp03-short-real-contract.docx`
- 原文件 SHA-256：`a827af9ac8463c550bbedf493e6040446ee6e6eddd790e325e114a418a375c70`
- 提取文本 SHA-256：`3d04a665cfd70493df395dd492ab092d58aa5caf97fcf7ee73ca1996e703504d`
- 关键原文：`本合同总金额为人民币 30,000 元（大写：人民币叁万元整）。`

最终正式运行：

- ReviewRun：`92d0a165-ce85-4b5b-9bd1-b1f7a8653f9f`
- 状态：`COMPLETED`，无降级原因
- 运行计划快照：`5eac5f84-7468-4b47-8bf4-343bacb35198`
- model_invocation：`450c58c8-c77f-4650-8354-13209e51e6ad`
- 模式：`route`，未钉死模型
- Provider / Model：`provider.lm-studio.local` / `google/gemma-4-e4b`
- 延迟：14,005 ms
- Token：输入 607、输出 561、合计 1,168，证据来源为 Provider
- 输入：全文 159 字符、覆盖率 100%、1/1 分块
- 输出校验：`passed`；1 个可用结果、0 丢弃、0 警告；canonical 规则/属性覆盖 1/1

确定性风险链：

- 风险卡：`3a3b4b4a-d750-445e-a7a4-d6cf7895ca9e`
- 绑定源 Rule：`cbcaee32-2fc8-4ee6-a516-a4790445cff8`
- 绑定 RuleSnapshot：`56e7231e-067f-4ab9-bcfb-d16b05695cdb`
- 属性读取：`30000 CNY`，状态 `read`，置信度 `1`
- 判定：`decision_1`，输出红线“低于最低签约金额”并阻止提交
- 原文定位：字符 73-105，`evidence_text_exact_match`，状态 `located`

这条链证明模型只读取“合同金额”事实，规则引擎用已发布 `< 50000` 判定生成风险与处理动作；模型没有自行解释或改写阈值。

## 4. 失败证据与纠正

失败结果均被系统拒绝，没有伪装成成功：

1. Production 模式调用 localhost 被端点安全策略拒绝，证明本地模型只用于本机验收，不能冒充线上可达。
2. 长合同在 8K 上下文只覆盖 1/7 分块，系统以覆盖不足降级，未把局部输出冒充全文审核。
3. Gemma 对未知可选字段输出 `null`。适配器只把可选 `value/unit/evidence=null` 解释为字段缺失；`status=read + value=null` 仍硬失败。
4. 固定格式示例曾写死 `R001`，模型照抄后因不在当前 SkillBundle 被拒绝。示例现从当前发布快照动态生成，模型编码与属性键不能漂移。
5. LM Studio 当前 Gemma 对 OpenAI `response_format=json_object` 返回 HTTP 400；该参数已撤回，保留 `temperature=0` 和服务端严格 JSON/业务校验。
6. 上传页在文件上传后直接启动审核，没有先生成 `contract_source_page_maps`，首次调用被 409 正确阻止。本验收为已上传原件补齐与文件哈希一致的页图身份后继续；上传编排缺步骤不混入 WP03，单独进入后续队列。

## 5. 浏览器与文件验收

- 桌面 1440×900：`scrollWidth=clientWidth=1440`；所有创建、测试、停用、保存操作可达。
- iPad 1024×768：`scrollWidth=clientWidth=1024`；仅主导航按钮为可见 fixed 元素，无残留遮罩或横向溢出。
- 页面能看到业务流程与发布验收结果；看不到内部 `RULE_MRUGHIOW` 和 Prompt。
- 桌面截图：`rule-config-desktop.png`
- iPad 截图：`rule-config-ipad.png`
- 真实工作台展示一条已定位红线、原文证据、客户侧处理建议和 DOCX 近似页预览。

## 6. 保留与发布边界

审计组织及其 ReviewRun、SkillBundle、运行计划和模型调用属于不可变验收证据，予以保留，不做伪清理。该 Preview 样本不含凭据明文。Production 数据库保持只读；本次没有 push、PR 或 Production 部署。

工作台顶部仍因 `blocked_without_independent_gold` 显示“审核降级（需复核）”。这是准确率发布门禁，不否定本次规则配置和真实运行闭环，也不能由单份受控合同替代独立金标评测。

## 7. 工程门禁

- WP03 目标测试：15 文件、206/206 通过。
- 全量测试：201 文件通过、2 文件跳过；1,437 测试通过、5 测试跳过。
- TypeScript：`pnpm exec tsc --noEmit` 通过。
- ESLint：`pnpm lint` 通过。
- Production build：Next.js 15.5.19，76 个静态页面生成完成，构建通过。
- Supabase security/performance advisors 已复跑。未发现本次函数覆盖新增的可变 `search_path`；Preview 仍报告项目既有的 RLS 无策略、重复宽松策略和重复索引待办，它们属于已登记的安全/性能治理线，不能被本次 WP03 宣称消除。
