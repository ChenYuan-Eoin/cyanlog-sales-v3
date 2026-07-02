# F014 标书中心 OCR

<!--
状态变更：drafting → in_progress → completed
回写：REQ_REGISTRY.yml / 本 packet / 03-design-truth / 04-implementation-truth
-->

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F014 |
| **Name** | 招标文件 OCR 解析 |
| **Module** | 标书中心 |
| **Branch** | `feature/F014-tender-ocr` |
| **Owner** | (待认领) |
| **Created** | 2026-06-02 |
| **Status** | `completed` |

---

## 2. 需求反讲

### 2.1 AI 复述

F014 复用 F008 的 OCR 基础能力，但提取的字段更结构化，针对"标书"场景：
- 项目基本信息（编号、名称、预算、截止日、招标人）
- **评分标准**（评分项 + 权重 + 最高分）— 标书专属
- **技术要求**（参数清单）
- **商务条款**（付款、交货、违约）
- **时间节点**（报名/开标/截止）

边界说明：F008 历史上曾被收纳在合同审核合并派生文档中；当前不属于合同审核第一阶段主链路，只作为本包复用的共享 OCR 能力。

来源：`product-truth/01-business-truth/标书中心.md`（TC-001 / TC-002 / TC-003）。

### 2.2 待确认问题

- [ ] 是否新建独立 API？**答：复用 F008 `/api/tenders/ocr`，增强 parser**
- [x] 评分标准如何从非结构化文本提取？**答：正则作为确定性底座，长文本/长 PDF 通过 F012 L2 云模型进行结构化增强，不再只依赖正则。**
- [ ] 数据库表是否新建？**答：复用 `ocr_results` 表，key_info 字段扩展**

### 2.3 本轮边界

**做**：
- 新建 `lib/ocr/tender-parser.ts` - 标书专用结构化解析器
- 新建 `lib/ocr/tender-ai.ts` - 通过 F012 `AI_LEVEL_2` 云端 OpenAI-compatible Provider 分块解析长文本标书
- 增强 `lib/ocr/parser.ts` 的 `extractKeyInfo` 与新 parser 协调
- 复用合同文本抽取能力解析 PDF/DOCX，避免 PDF 上传直接落入占位文案
- 完善 `/tenders` 列表页（带"上传招标文件"入口）
- 新建 `/tenders/[id]` 详情页（展示完整解析结果：基本/评分/技术/商务/时间）
- 单元测试覆盖各种正则场景
- 导航已经存在（合同旁边的标书中心）

**不做**：
- 标书自动生成（TC-004，超出 v1）
- 标书导出（TC-005，P2）
- 真正的 PaddleOCR 部署（复用占位实现）

---

## 3. 技术方案

### 3.1 接口设计

复用 `POST /api/tenders/ocr`，增强响应字段：
```ts
Response: {
  id: string,
  originalFile: string,
  extractedText: string,
  keyInfo: {
    tenderNo, tenderName, budget, deadline, publisher, contact,  // 基础
    scores: [{ item, weight, maxScore }],                          // 评分
    technicalRequirements: string[],                                // 技术
    commercialTerms: string[],                                      // 商务
    timeline: [{ event, date }],                                    // 时间
    aiRuntime?: {
      provider, model, transport,
      chunk_count, selected_chunk_count, analyzed_chunk_count,
      text_length, selected_text_length, analyzed_text_length,
      coverage_ratio, chunk_coverage_ratio, character_coverage_ratio,
      processing_ms, concurrency, degraded, attempt_errors,
      model_invocation_id
    }
  },
  confidence: number
}
```

### 3.2 数据模型

复用 `ocr_results.key_info` JSON 字段，不新建表。

### 3.3 状态机

无（解析是无状态的转换）。

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 正则不覆盖所有招标文档格式 | v1 接受低 recall，v2 接入 AI |
| OCR 文本质量差 | 信心度分数 < 50 时提示人工核对 |
| 关键字段缺失 | UI 显示空态 + "未识别到 XX" |
| 时间节点误抽取长正文 | 没有标准日期时只接受“另行通知/以公告为准”等短文本 fallback，不允许把后续正文当日期 |
| 云端模型不可用或输出不合法 | 不生成可验收解析结果，接口返回 `TENDER_CLOUD_MODEL_UNAVAILABLE`；同时写入失败 `model_invocations`，记录 provider/model/transport/attempt_errors。确定性解析只可作为内部诊断输入，不能包装成完整 AI 解析成功 |
| 长文本一次性输入过长 | 使用段落分块，按 chunk 调用 L2 云模型后合并结构化结果；分块选择必须覆盖首尾、高信号关键词段和均匀采样段，不能只取前 N 段 |
| 长 PDF 只解析前段 | 不允许静默成功；记录 `text_length / selected_text_length / analyzed_text_length`、`chunk_coverage_ratio` 和 `character_coverage_ratio`，覆盖不完整时 `degraded=true` |
| 模型调用不可追溯 | 云端解析必须写入 `model_invocations.phase=tender_long_document_parse`，并在 `key_info.aiRuntime.model_invocation_id` 回链 |
| 扫描件 PDF 无文本层 | 本轮不伪造 OCR；返回人工/OCR 引擎需求，后续需接云端视觉 OCR 或本地 OCR 引擎 |

---

## 4. 视觉锚点

参考 `/contracts/[id]` 详情页的卡片分组展示风格（评分/技术/商务分组）。

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | parseDocument PDF 入口 | 可复制文本 PDF 能抽取文本；扫描/无文本 PDF 明确返回 OCR/视觉模型需求 |
| 单元测试 | tender-parser 5 类提取 | 各自正常/异常/混合场景 |
| 单元测试 | tender-ai JSON 清洗、分块选择与合并 | `<think>` / fenced JSON 可解析；长文选择包含首尾、高信号段和全局采样；AI 结果可与正则结果合并 |
| 单元测试 | tender OCR API 云模型证据 | 云模型增强成功时写入 `model_invocations`，响应回传 `model_invocation_id` |
| 集成测试 | 完整 API 调用 | 200 响应 + 完整 keyInfo |
| 人工验收 | 真实 PDF/Word/长文本 | UI 完整渲染，`key_info.aiRuntime.transport=openai_compatible_http`，并能看到字符覆盖率、chunk 覆盖率、耗时和调用 ID |

---

## 6. 实施记录

### 2026-06-02

- 创建 `lib/ocr/tender-parser.ts`（5 类提取）
- 创建 `lib/ocr/tender-parser.test.ts`（10+ 用例）
- 增强 `app/tenders/page.tsx`（上传入口 + 列表）
- 创建 `app/tenders/[id]/page.tsx`（详情页）

### 2026-07-02

- `POST /api/tenders/ocr` 改为先做确定性解析，再调用 F012 `sales_cloud_backup` 云端模型分块增强。
- `lib/ocr/parser.ts` 复用 `extractContractText`，支持可复制文本 PDF/DOCX，不再对所有 PDF 返回占位文案。
- 真实 API 验证：短标书文本上传返回 `AI_LEVEL_2 / gpt-5.5 / openai_compatible_http`，1 个 chunk 解析完成，`confidence=100`。
- 标书长文本云模型调用写入 `model_invocations.phase=tender_long_document_parse`；运行结果回写 `key_info.aiRuntime.model_invocation_id`、字符覆盖率、chunk 覆盖率、耗时、并发和降级原因。
- `/tenders/upload` 作为标书上传入口；`/tenders/[id]` 展示 OCR 结果和 AI 解析证据，不再挂载与 OCR 结果对象不匹配的 Tender Workflow 占位链路。
- OpenAI-compatible Provider Base URL 支持根域名规范化为 `/v1`，例如 `https://cloud.yiyongai.cn` 会按 `https://cloud.yiyongai.cn/v1` 调用。
- 时间节点确定性提取收紧：无标准日期时只接受短 fallback，避免长 PDF/长文本重复词把整段正文误判为时间节点。
- 质量边界：可复制文本 PDF/DOCX 已纳入云端分块解析；扫描件 PDF 仍需 OCR/视觉模型，不得宣称完整支持。

### 代码位置

- `lib/ocr/tender-parser.ts`
- `lib/ocr/tender-ai.ts`
- `lib/ocr/tender-ai.test.ts`
- `lib/ocr/tender-parser.test.ts`
- `lib/ocr/parser.ts`
- `app/api/tenders/ocr/route.ts`
- `app/tenders/page.tsx`（修改）
- `app/tenders/[id]/page.tsx`（新建）
- `app/tenders/[id]/page.test.tsx`（新建，待补）

---

## 7. 状态变更日志

| 日期 | 状态 | 变更说明 |
|------|------|---------|
| 2026-06-02 | drafting → in_progress | 开始实施 |
| 2026-06-02 | in_progress → completed | 完成 5 段结构化提取 + 11 个单测 + 详情页 |
| 2026-07-02 | completed → hardening | 接入 F012 L2 云端模型分块解析和运行证据 |
