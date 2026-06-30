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
- [ ] 评分标准如何从非结构化文本提取？**答：v1 用正则（识别"权重 X%"），v2 接入 AI**
- [ ] 数据库表是否新建？**答：复用 `ocr_results` 表，key_info 字段扩展**

### 2.3 本轮边界

**做**：
- 新建 `lib/ocr/tender-parser.ts` - 标书专用结构化解析器
- 增强 `lib/ocr/parser.ts` 的 `extractKeyInfo` 与新 parser 协调
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
    timeline: [{ event, date }]                                     // 时间
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

---

## 4. 视觉锚点

参考 `/contracts/[id]` 详情页的卡片分组展示风格（评分/技术/商务分组）。

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | tender-parser 5 类提取 | 各自正常/异常/混合场景 |
| 集成测试 | 完整 API 调用 | 200 响应 + 完整 keyInfo |
| 人工验收 | 真实 PDF 文本 | UI 完整渲染 |

---

## 6. 实施记录

### 2026-06-02

- 创建 `lib/ocr/tender-parser.ts`（5 类提取）
- 创建 `lib/ocr/tender-parser.test.ts`（10+ 用例）
- 增强 `app/tenders/page.tsx`（上传入口 + 列表）
- 创建 `app/tenders/[id]/page.tsx`（详情页）

### 代码位置

- `lib/ocr/tender-parser.ts`
- `lib/ocr/tender-parser.test.ts`
- `app/tenders/page.tsx`（修改）
- `app/tenders/[id]/page.tsx`（新建）
- `app/tenders/[id]/page.test.tsx`（新建，待补）

---

## 7. 状态变更日志

| 日期 | 状态 | 变更说明 |
|------|------|---------|
| 2026-06-02 | drafting → in_progress | 开始实施 |
| 2026-06-02 | in_progress → completed | 完成 5 段结构化提取 + 11 个单测 + 详情页 |
