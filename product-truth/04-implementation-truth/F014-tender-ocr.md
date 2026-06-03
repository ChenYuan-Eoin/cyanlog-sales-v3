---
req_id: F014
name: 标书中心 OCR
type: feature-implementation
status: completed
completed_at: "2026-06-02"
---

# F014 实施证据

## 文件清单

| 文件 | 行数 | 角色 |
|------|------|------|
| `lib/ocr/tender-parser.ts` | ~180 | 标书专用结构化解析器 |
| `lib/ocr/tender-parser.test.ts` | ~150 | 11 个单测 |
| `app/api/tenders/ocr/route.ts` | +5 行 | API 切换到 tender parser |
| `app/tenders/page.tsx` | ~110 | 列表页（重构为 server component） |
| `app/tenders/[id]/page.tsx` | ~200 | 详情页（5 段展示） |

## 核心能力

### 结构化提取（5 段）

1. **基础信息**：6 字段（编号/名称/预算/截止/招标人/联系）
2. **评分标准**：识别"X 权重 Y% 满分 Z"格式
3. **技术要求**：识别"技术要求：xxx"块 + "应具备xxx"句式
4. **商务条款**：识别 5 类（付款/交货/质保/违约/保证金）
5. **时间节点**：识别 10 类事件 + 中英文日期格式

### 信心度计算

```
信心度 = (基础字段命中数 / 6) × 60% + 扩展类别命中数 × 10%
```

- 80%+ 高（绿）— 大部分字段已识别
- 50-80% 中（蓝）— 部分识别
- <50% 低（灰）— 需人工核对

### 数据复用

- 复用 `ocr_results` 表
- 扩展 `key_info` JSON 字段
- 不新建数据库表

## 验证结果

- `pnpm typecheck` → 0 错误
- `pnpm test:run` → 106+ 通过（新增 11 个 tender-parser 测试）
- `pnpm lint` → 0 警告

## 测试覆盖

| 测试类 | 用例 |
|--------|------|
| 完整解析 | 2（空文本/完整文档） |
| extractScores | 3（4 项/空/越界） |
| extractTechnicalRequirements | 2（块/句式） |
| extractCommercialTerms | 3（付款/质保/多项） |
| extractTimeline | 3（3 类/中文日期/无时间） |
| 信心度 | 2（满/上限） |

## 已知限制

- v1 用正则提取，recall 有限（v2 可接入 AI）
- 真实 PaddleOCR 部署未完成（复用占位）
- 无标书生成功能（TC-004，留待 F024+）
