<!--
文件名: REQ_TRACKING.md
用途: 需求追踪锚点规范 - 代码与需求的关联机制
所属层: 治理层
创建者: AI Assistant
更新规则: 新增追踪需求时更新
REQ: GOV-TRK-001
-->

# 需求追踪锚点规范

## 目的

建立代码与需求的**双向追溯链**，确保：
1. 每段代码都有对应的需求来源
2. 每个需求都有代码实现位置记录
3. 变更时可以完整追溯影响范围

---

## 追踪锚点类型

### 锚点1：文件头 REQ 标记

**适用**：所有源代码文件 (.ts, .tsx, .js, .jsx, .py, etc.)

```typescript
// REQ:F001
// PURPOSE: 价盘管理服务
// AUTHOR: ChenYuan
// CREATED: 2026-05-14
// MODIFIED: 2026-05-15

import { ... } from '...';

export async function priceService() {
  // ...
}
```

**检查规则**：
- ✅ 必须包含 `REQ:F{xxx}`
- ✅ Fxxx 必须在 REQUIREMENTS.md 中存在
- ✅ Fxxx 状态必须是"已确认"或"已完成"
- ❌ 禁止多个 REQ 在同一文件（考虑拆分）

---

### 锚点2：函数级 REQ 标记

**适用**：大型文件包含多个需求实现时

```typescript
/**
 * 计算报价总额
 * @REQ F002 - 报价编制
 * @SECTION F002-1
 */
function calculateQuoteTotal(items: QuoteItem[]): number {
  // ...
}

/**
 * 生成报价版本快照
 * @REQ F002 - 报价编制
 * @SECTION F002-7
 */
function createQuoteSnapshot(quote: Quote): QuoteSnapshot {
  // ...
}
```

**格式规范**：
| 标记 | 含义 | 示例 |
|------|------|------|
| `@REQ` | 对应需求ID | `@REQ F001` |
| `@SECTION` | 需求细分项 | `@SECTION F001-4` |
| `@DEPENDS` | 依赖的其他功能 | `@DEPENDS F003, F007` |

---

### 锚点3：CHANGELOG 关联

**适用**：自动生成变更记录

```markdown
| 时间 | 类型 | 详情 | REQ ID | 代码位置 |
|------|------|------|--------|---------|
| 2026-05-15 14:30 | 功能实现 | F001 价盘列表页 | F001 | `product/src/app/prices/page.tsx` |
| 2026-05-15 16:00 | 功能实现 | F002 报价创建 | F002 | `product/src/app/quotes/new/page.tsx` |
```

---

## REQUIREMENTS.md 追踪字段

需求表必须包含"代码位置"列：

```markdown
| ID | 需求名称 | 状态 | 代码位置 |
|----|---------|------|---------|
| F001 | 价盘管理 | **已确认** | [`/app/prices`](product/src/app/prices/page.tsx) |
| F002 | 报价编制 | **开发中** | [`/app/quotes`](product/src/app/quotes/page.tsx) |
| F003 | 报价计算 | **待确认** | - |
| F004 | 三级审批 | **已确认** | - |
```

**状态与代码位置规则**：

| 状态 | 代码位置要求 |
|------|-------------|
| 草稿 | 可以为 `-` |
| 待确认 | 可以为 `-` |
| 已确认 | 可以为 `-`（待开发） |
| 开发中 | 必须填写具体文件路径 |
| 已完成 | 必须填写具体文件路径 |

---

## 追踪验证脚本

### H007_追踪完整性检查

```javascript
// governance/harness/hooks/check-req-tracing.js

const fs = require('fs');
const glob = require('glob');

function checkTracing() {
  const issues = [];

  // 1. 找出所有带 REQ 标记的文件
  const sourceFiles = glob.sync('product/src/**/*.{ts,tsx}', {
    cwd: process.cwd()
  });

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const reqMatch = content.match(/REQ:\s*(F\d{3})/);

    if (!reqMatch) {
      issues.push({
        type: 'missing_req',
        file,
        message: '文件缺少 REQ 标记'
      });
      continue;
    }

    const reqId = reqMatch[1];

    // 2. 检查 REQ ID 是否有效
    const reqFile = fs.readFileSync('product/docs/REQUIREMENTS.md', 'utf-8');
    if (!reqFile.includes(reqId)) {
      issues.push({
        type: 'invalid_req',
        file,
        reqId,
        message: `REQ ID ${reqId} 在需求文档中不存在`
      });
    }
  }

  // 3. 检查 REQUIREMENTS.md 中的代码位置
  const reqs = parseRequirements(); // 解析需求表
  for (const req of reqs) {
    if (req.status === '开发中' || req.status === '已完成') {
      if (!req.codeLocation || req.codeLocation === '-') {
        issues.push({
          type: 'missing_location',
          reqId: req.id,
          message: `需求 ${req.id} 状态为${req.status}但无代码位置`
        });
      }
    }
  }

  return issues;
}
```

---

## 双向追溯矩阵

```
REQUIREMENTS.md
     │
     │ 记录
     ▼
┌─────────────────┐
│ F001 价盘管理   │◄──────────────────────┐
│ 状态: 已完成    │                       │
│ 代码位置: /price│                       │
└────────┬────────┘                       │
         │                                │
         │ 引用                           │ 更新
         ▼                                │
┌─────────────────┐     REQ:F001         │
│ /app/price/*    │───────────────────────┘
│    page.tsx     │      校验
│    actions.ts   │
└─────────────────┘
```

---

## 追踪自动化

### 1. 自动更新代码位置

```bash
# 当文件被创建时，自动更新 REQUIREMENTS.md
# Hook: post-file-create

如果文件包含 REQ:F001:
   更新 REQUIREMENTS.md 中 F001 的代码位置列
```

### 2. 变更影响分析

```bash
# 当 F001 需求变更时，找出所有影响文件
grep -r "REQ:F001" product/src/
```

---

## 追踪检查清单

### 开发阶段

- [ ] 文件头包含 `// REQ:Fxxx`
- [ ] 大函数包含 `@REQ Fxxx` JSDoc
- [ ] REQUIREMENTS.md 中该需求有对应条目
- [ ] 状态为"已确认"或之后

### 验收阶段

- [ ] REQUIREMENTS.md 中"代码位置"列已填写
- [ ] 代码位置可点击访问到正确文件
- [ ] 变更历史可追溯

---

**违规示例**（会导致提交失败）：

```typescript
// ❌ 缺少 REQ 标记
export function someFunction() {
  // ...
}

// ❌ REQ ID 不存在
// REQ:F999  // F999 未在需求文档中定义

// ❌ 多个 REQ 混用（应拆分文件）
// REQ:F001
// + 大量 F002 相关代码
```

**合规示例**：

```typescript
// ✅ REQ:F001
// PURPOSE: 价盘管理 - 产品目录 CRUD
// AUTHOR: ChenYuan
import { ... } from '...';

/**
 * 创建产品目录
 * @REQ F001
 * @SECTION F001-4
 */
export async function createCatalog(...) {
  // ...
}
```
