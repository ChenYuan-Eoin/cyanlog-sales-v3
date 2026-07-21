# WP05 工作台交互纠偏验收

日期：2026-07-21

候选分支：`codex/rule-collection-reset`

环境：隔离 Supabase Preview `vsfropnfsmnonkotywsx`；Production 只读且未部署

## 1. 本批目标与边界

本批只解决工作台的两项任务阻断：

1. 用户从合同列表进入时，默认先处理风险和谈判任务，即进入“审查”；运行状态只能改变下一步提示，不能替用户选择“证据”等页签。
2. 用户选择风险后，只允许源文档阅读区定位和滚动；不得带动浏览器页面，也不得让长文档把布局撑成看似白色遮罩的空白区域。

本批不宣称审核准确率、上传新版本、风险迁移、循环复审或最终交付已经完成。

## 2. 根因链

### 2.1 默认入口错误不是文案问题，而是状态职责混淆

- 世界/业务：工作台主任务是处理风险；“证据”是用户显式追溯时才打开的辅助面板。
- 需求：合同的运行状态决定“下一步做什么”，页签由用户决定。
- 代码根因：`ReviewWorkflowState.detailPanel` 把失败、完成、导出受阻等运行状态直接映射为 `evidence`，合同列表又把该字段拼进入口 URL。结果是“下一步提示”和“默认页面”成为同一个状态。
- 修复：删除状态机中的 `detailPanel`；列表入口对全部状态都生成无 `panel` 的工作台 URL，仍保留状态对应的下一步文案。

### 2.2 页签刷新/前进后退不一致来自双状态源

- 需求：显式页签选择可刷新、可分享、可前进后退；无参数始终是“审查”。
- 代码根因：页面只在首次挂载时从 `window.location.search` 读一次参数，之后用 React 本地状态切换；URL 与界面分别成为真相源。
- 修复：页签完全由 `useSearchParams` 派生；统一导航函数只在非审查页签写入 `panel`，切回审查时删除参数，并保留 `from` 等无关上下文；同 URL 不重复压入历史记录。

### 2.3 长 DOCX 的“白块/滚不动”是几何和滚动所有权错误，不是颜色或 z-index

- 需求：文档阅读区是一个有边界的阅读器；风险定位只改变阅读器内部位置。
- 代码根因：外框只有最小高度，DOCX 内容仍参与父级尺寸计算，所谓滚动层会被全文撑高到 `clientHeight === scrollHeight`；`scrollIntoView` 又会遍历并滚动祖先，导致浏览器窗口跟随。`overscroll-contain` 在伪滚动或边界状态还会吞掉滚轮。
- 修复：外框受视口上限约束，frame 隔离内容尺寸，唯一滚动层绝对铺满 frame 并使用 `overflow-auto/overscroll-auto`；定位根据元素与阅读器矩形计算目标 `scrollTop`，只调用内部 viewport 的 `scrollTo`。
- 结论：本批观察到的工作台白色覆盖不是残留弹层；页面没有大面积 fixed 白色元素。根因是长内容把布局表面撑开，现由尺寸约束和单一滚动所有权消除。

### 2.4 原文定位必须同时处理 Word run 切分、重复条款和错误拼接

- 代码根因：旧逻辑只在单个 TextNode 内查找；Word 会把一句话拆进多个 span/run。初版跨节点修复又暴露两个风险：把相邻段落拼成一条不存在的原文；相同短语多次出现时默认选第一处。
- 修复：只允许在同一段落、列表项、单元格或标题内跨 run 合并；相邻业务块绝不拼接。唯一命中可直接定位；重复命中必须用 ReviewRun 已记录的 `source_range` 和解析原文上下文消歧；范围不一致或仍不唯一时返回“多处相同原文，需人工定位”，不冒充成功。

### 2.5 连续风险切换错位来自重复定位与布局竞争

- 代码根因：DOCX 渲染完成和状态 effect 各执行一次定位，fit-width 缩放尚未稳定时也可能计算坐标。
- 修复：只保留一个定位 effect；等待最终 zoom 布局的下一帧执行，并在选择变化时取消旧 frame，保证最后一次选择获胜。

### 2.6 PDF 与渲染失败必须显式降级

- PDF 使用浏览器原生 viewer，应用不能可靠控制其文本偏移和滚动位置，因此不能把“iframe 已显示”解释为“风险已定位”。文本 PDF 明示按页核对；无文本层/扫描 PDF 明示 OCR 只能辅助，不能形成原文锚点。
- DOCX 换文件、重新加载或渲染失败时先清除旧 focus/page 状态；失败显示需人工定位，上一份文件的“已定位”不会残留。

## 3. 工程验收

- WP05 目标测试：`6` 个文件、`47/47` 通过。
- 全量 Vitest：`203` 个文件通过、`2` 个跳过；`1459` 项通过、`5` 项真实 live 测试按默认策略跳过。
- `pnpm exec tsc --noEmit --incremental false`：通过。
- 全量 ESLint：通过。
- Preview 环境生产构建：Next.js `76/76` 页面生成通过。
- `git diff --check`：通过。

回归覆盖：9 种合同运行状态直接调用真实列表导航 helper，入口均无隐式 `panel`；无效/缺失参数归一为审查；页签 URL 保留无关参数；DOCX 单一滚动所有权、同块跨 run、相邻段落禁止拼接、重复原文无锚点失败关闭、`source_range` 消歧、缺失证据不滚动、最终 zoom 后定位、旧 frame 取消、旧状态清理和 PDF 可收缩/人工定位边界均有测试。

## 4. 真实浏览器验收

### 4.1 URL 与默认任务

真实长 DOCX 工作台在 `1440×900` 下验证：

| 动作 | URL 状态 | 激活页签 | `window.scrollY` |
|---|---|---|---:|
| 无 `panel` 打开 | 无 `panel` | 审查 | 0 |
| 点击证据 | `panel=evidence` | 证据 | 0 |
| 刷新 | `panel=evidence` | 证据 | 0 |
| 切回审查 | 删除 `panel` | 审查 | 0 |
| 后退 | `panel=evidence` | 证据 | 0 |
| 前进 | 无 `panel` | 审查 | 0 |

合同列表中的已完成短/长合同入口均只有 `from=list`，不再由运行状态附加 `panel=evidence`。

### 4.2 长 DOCX

真实文件 `WP03-真实合同审核样本.docx`，解析文本 `15,686` 字符，浏览器近似页预览 `4` 页。

| 视口 | 阅读器 `clientHeight` | `scrollHeight` | 横向溢出 |
|---|---:|---:|---:|
| 桌面 1440×900 | 558 px | 12,755 px | 0 |
| iPad 1024×768 | 426 px | 12,083 px | 0 |

- 真实滚轮从内部 `scrollTop=2000` 到 `2800`，浏览器窗口保持 `603.5`，证明滚轮由阅读器消费。
- 起始跨节点原文可定位到完整段落，内部 `scrollTop=37.5`，窗口保持 0。
- 末页原文“信创环境 - 集群私有部署硬件环境配置”定位到第 4 页，桌面内部 `scrollTop=11784`，窗口保持 0。
- 带真实 `source_range=15102..15121` 的 Preview 临时风险再次定位到同一末页原文；页面显示“已定位原文 / 定位第 4 页”，`scrollTop=11784`、窗口为 0。临时风险验收后删除。
- 连续执行末尾→开头→末尾，最终仍定位末尾，旧定位没有覆盖最后一次选择。
- 页面不存在覆盖半个视口以上的 fixed 白色元素；控制台 error 为 0。

### 4.3 文本 PDF 与扫描 PDF

通过两条只引用既有 Preview Storage 对象的临时合同记录进行浏览器验收，未复制或修改原文件：

| 文件 | 文本状态 | 页数 | 桌面 host/iframe | iPad host/iframe | PDF 内滚动后外层窗口 |
|---|---|---:|---:|---:|---|
| 文本 PDF | `parsed_chars=1378` | 8 | 638/523.5 px | 506/391.5 px | 116.5→116.5；217.5→217.5 |
| 扫描 PDF | `parsed_chars=0` | 50 | 638/523.5 px | 506/391.5 px | 210→210；217.5→217.5 |

- 四个场景均显示 Chromium 原生 PDF Viewer，无白色遮罩和横向溢出。
- 文本 PDF 明示“原生查看器不提供可靠的合同文本偏移跳转，需按页核对”；扫描 PDF 明示“没有可用文本层，OCR 只能辅助定位，不能冒充原文锚点”。
- 滚轮后 PDF 页码从第 1 页前进；扫描 PDF 到第 3/50 页，外层页面位置不变。
- 当前轮文件与 review API 均为 HTTP 200，控制台 error 为 0。

## 5. Preview 清理与发布边界

- DOCX 定位临时风险卡：删除 `2` 条，二次查询剩余 `0`。
- `source_range` 确定性定位临时风险：删除 `1` 条，二次查询剩余 `0`。
- PDF 临时合同引用：`canary_contracts=0`；两份原合同与两份原 Storage 对象仍为 `2/2`。
- 临时浏览器认证文件和独立 PDF 浏览器 session 已删除。
- 未写 Production，未 push，未创建 PR，未部署 Production。

## 6. 证据索引

- `output/playwright/wp05/desktop-workbench-clean.png`
- `output/playwright/wp05/desktop-long-docx.png`
- `output/playwright/wp05/desktop-source-range-anchor.png`
- `output/playwright/wp05/ipad-long-docx.png`
- `output/playwright/wp05/pdf-text-desktop-after-wheel.png`
- `output/playwright/wp05/pdf-text-ipad.png`
- `output/playwright/wp05/pdf-scan-desktop-after-wheel.png`
- `output/playwright/wp05/pdf-scan-ipad-after-wheel.png`

## 7. 退出结论

WP05 的交互纠偏子批通过：运行状态、用户页签和 URL 已分责；无参数默认审查；长 DOCX、文本 PDF、扫描 PDF 都有稳定且唯一的阅读滚动边界，定位不会再滚动浏览器页面。审核准确率与循环复审仍必须在各自门禁满足后单独验收。
