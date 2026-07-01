# Feature Packet: F007-Word 原生批注与报告输出

**REQ ID**: F007
**Status**: confirmed
**Parent**: 合同审核
**Depends On**: `F005v2-contract-center`, `F006-contract-review-skill-runtime`
**Consumed By**: 销售、法务、客户协作、合同归档

---

## 1. 单元定义

**目标**：以 Word 原生批注为合同审核主产物，将 F006 生成的风险事实写回源文件的新版本；审核报告只作为辅助、兜底和归档产物。

F007 不负责判断风险是否存在，只负责把已确认的审核事实转成可协作、可下载、可归档的文档输出。

**这包拥有的内容**：
- `CommentPatch` 结构
- 风险项到原文位置的定位策略
- Word 原生批注生成
- 批注文件版本管理
- 报告辅助输出
- 批注失败降级和一致性校验

**这包不拥有的内容**：
- 规则配置（属于 `F009`）
- Skill 执行和风险判断（属于 `F006`）
- 销售谈判和客户反馈（属于 `F005`）
- 模型调用策略（属于 `F012`）

---

## 2. 输出原则

| 原则 | 说明 |
|------|------|
| 批注为主 | 主输出是原合同新版本 + Word 原生批注 |
| 报告为辅 | 报告用于内部复核、归档、批注失败兜底 |
| 同源事实 | 批注和报告必须引用同一 `RiskFinding` |
| 可降级 | 只有能匹配原文片段的段落级定位才可写入批注；完全无法绑定原文时只能标记人工定位或生成独立报告，不能标记为批注成功 |
| 可追溯 | 输出文件必须绑定合同版本、ReviewRun、SkillBundle 和生成时间 |

---

## 3. CommentPatch 契约

```ts
interface CommentPatch {
  id: string
  review_run_id: string
  risk_finding_id: string
  contract_version_id: string
  author_name: 'ONES 业务运营' | string
  severity: 'red' | 'yellow' | 'green' | 'white'
  title: string
  body: string
  suggestion: string
  evidence: {
    selected_text: string
    clause_ref?: string
    start_offset?: number
    end_offset?: number
    locator_confidence: number
  }
  negotiation?: {
    required: boolean
    bottom_line?: string
    suggested_script?: string
  }
}
```

`CommentPatch` 是写入 Word 前的结构化意图。它必须先被保存或可重建，不能只存在于导出函数的临时变量中。

---

## 4. 批注生成流程

```
RiskFinding
  -> CommentPatch
  -> 位置定位
  -> Word 原生批注写入
  -> AnnotatedDocument
  -> 文件校验
  -> 输出到合同工作台
```

### 4.1 位置定位等级

| 等级 | 说明 | 是否可作为主路径 |
|------|------|----------------|
| L1 精确区间 | 通过 start/end offset 或 docx run 定位到原文片段 | 是 |
| L2 片段匹配 | 通过 selected_text 匹配到段落内文本 | 是 |
| L3 段落级 | 通过 selected_text 能命中某个段落，但无法取得精确 run offset | 可接受，但需标记降级 |
| L4 人工定位 / 报告兜底 | 无法在源文件命中 selected_text 或缺少证据原文 | 不可标记为批注成功 |

第一阶段至少要支持 L2/L3，并清楚显示定位置信度和降级原因；后续再提升 L1 覆盖率。不得把风险标题、规则名称或其他非合同原文作为 selected_text 写入源文件批注。

源文件批注接口的成功语义只对应 L1/L2/L3 的 Word 原生批注版。L4 人工定位 / 报告兜底必须走工作台告警、报告输出或错误提示，不允许在 `review_revision` 中登记为“批注版”。

### 4.2 Word 批注内容

每条批注必须包含：
- 风险等级
- 风险标题
- 规则或模板依据
- 问题说明
- 修改建议
- 是否需要销售谈判
- `RiskFinding` 编号或可追溯 ID

### 4.3 文件版本

| 版本类型 | 说明 |
|----------|------|
| `source` | 用户上传或客户回传的源文件 |
| `annotated` | 系统生成的带批注版本 |
| `customer_returned` | 客户基于批注修改或反馈后的版本 |
| `report` | 辅助报告文件 |

生成 `annotated` 文件时必须关联原 `source` 版本，不能覆盖源文件。

---

## 5. 报告辅助输出

报告不是主审核体验，但必须可用：
- 批注文件生成失败时，报告必须可下载。
- 报告与批注的问题数量、风险等级、证据引用必须一致。
- 报告应包含规则快照、SkillBundle、模型策略、处理人和降级原因。

### 5.1 历史输出资产摘录

从 `F005-derive.md` 摘录到 F007 的内容如下：

| 历史资产 | 第一阶段处理 |
|----------|--------------|
| 报告版 + 批注版双产物 | 保留，但产品主路径是批注版；报告仅辅助、兜底、归档 |
| 文件命名思路 | 保留版本号、订单/客户信息、输出类型，但最终命名由 `ContractVersion` 和输出记录统一生成 |
| 报告三表 | 可作为报告内部结构参考，不作为前端主体验 |
| 批注内容包含风险和建议 | 保留，并强制引用 `RiskFinding` 和规则/模板依据 |

明确废弃：
- 不允许把批注统一追加到文档末尾“审核摘要”段落后宣称批注成功。
- 不允许只生成报告、不生成源文件新版本。
- 不允许批注和报告使用两套风险 ID 或两套结论。

---

## 6. API 草案

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/contracts/:id/review-runs/:runId/comment-patches` | 生成或重建批注意图 |
| `POST` | `/api/contracts/:id/review-runs/:runId/export/annotations` | 生成带 Word 批注的新文件版本 |
| `GET` | `/api/contracts/:id/versions/:versionId/download` | 下载源文件/批注版/客户回传版 |
| `POST` | `/api/contracts/:id/review-runs/:runId/export/report` | 生成报告辅助产物 |
| `GET` | `/api/contracts/:id/review-runs/:runId/outputs` | 查询批注、报告、降级原因 |

---

## 7. 现有资产复用

优先复用：
- `app/api/contracts/[id]/export/route.ts`
- `lib/export/word-generator.ts`
- `lib/export/word-generator.py`
- `contract_annotations`
- `contract_risk_cards`
- `contract_reviews`

需要改造：
- 不能只在文档末尾追加“审核摘要”冒充原生批注。
- 必须把 `RiskFinding` 和 `CommentPatch` 映射到源文件位置。
- 导出接口必须返回输出版本、降级原因和一致性校验结果。

---

## 8. 验收标准

- [ ] 每个批注都能追溯到 `RiskFinding`
- [ ] 批注版文件不会覆盖源文件，会生成新的 `ContractVersion`
- [ ] 至少支持 L2 片段匹配和 L3 段落级定位
- [ ] 批注失败时生成报告，并展示明确降级原因
- [ ] 报告和批注使用同一问题 ID、风险等级和证据
- [ ] 下载后的 docx 可在 Word/WPS 中打开且保留正文
- [ ] 输出记录包含生成时间、生成者、ReviewRun、SkillBundle、规则快照
