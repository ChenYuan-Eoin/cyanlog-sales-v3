<!--
文件名: PRD_SYNC_WORKFLOW.md
用途: PRD回写机制 - 功能实现后自动更新PRD的流程
所属层: 治理层
创建者: AI Assistant
更新规则: 回写流程变更时更新
REQ: GOV-SYNC-001
-->

# PRD 回写机制

## 问题

功能开发与PRD文档**持续不同步** - 开发者写完代码后忘记更新文档，导致：
1. 新团队成员查阅PRD时看到过时信息
2. 验收时无法确认功能是否符合预期
3. 后续迭代基于错误假设

## 解决方案

建立"代码交付即文档更新"的**强制回写流程**。

---

## 回写触发条件

| 场景 | 触发 | 动作 |
|------|------|------|
| 功能开发完成 | `// REQ:Fxxx` 文件合并到 main | 自动检查 PRD 对应章节 |
| bug修复 | 修复涉及业务逻辑 | 自动检查 PRD 描述准确性 |
| 需求变更 | REQUIREMENTS.md 更新 | 提示更新 PRD-PRODUCT.md |

---

## 回写检查清单

开发者在标记功能"已完成"时，必须执行以下检查：

### 标记前检查（开发者执行）

```markdown
## Fxxx 功能完成检查清单

### 代码层面
- [ ] 所有文件包含 REQ:Fxxx 标记
- [ ] 测试覆盖率 > 80%
- [ ] 边界情况处理完整

### 文档层面
- [ ] PRD-PRODUCT.md 对应章节已更新
  - [ ] 状态从"进行中"→"已完成"（或闭合度 90%）
  - [ ] 技术方案与实际实现一致
  - [ ] 验收标准可验证
- [ ] REQUIREMENTS.md 状态更新为"已完成"
  - [ ] 代码位置列已填写
  - [ ] 如有变更，变更历史已记录

### 变更记录
- [ ] CHANGELOG.md 已生成对应条目
- [ ] 如有API变更，注释已更新
```

---

## 自动回写脚本

### H008_PRD同步检查

```javascript
// governance/harness/validators/prd-sync-check.js

const fs = require('fs');

/**
 * 检查 PRD-PRODUCT.md 与 REQUIREMENTS.md 的同步状态
 */
function checkPrdSync() {
  const prd = fs.readFileSync('product/PRD-PRODUCT.md', 'utf-8');
  const req = fs.readFileSync('product/docs/REQUIREMENTS.md', 'utf-8');

  const issues = [];

  // 检查所有 Fxxx 需求
  const fPattern = /F\d{3}/g;
  const reqMatches = [...req.matchAll(fPattern)].map(m => m[0]);
  const prdMatches = [...prd.matchAll(fPattern)].map(m => m[0]);

  // 1. 检查 REQ 中的 Fxxx 是否在 PRD 中有定义
  for (const fid of new Set(reqMatches)) {
    if (!prd.includes(fid)) {
      issues.push({
        type: 'missing_in_prd',
        fid,
        message: `${fid} 在 REQUIREMENTS.md 中存在，但在 PRD-PRODUCT.md 中无定义`
      });
    }
  }

  // 2. 检查已完成需求的状态一致
  const reqLines = req.split('\n');
  for (const line of reqLines) {
    const match = line.match(/\|\s*F\d{3}.*已完成.*\|/);
    if (match) {
      const fid = match[0].match(/F\d{3}/)[0];
      // 检查 PRD 中是否标记为已完成
      if (!prd.includes(`${fid}`) || !prd.match(new RegExp(`${fid}.*完成|闭合度.*90%|100%`))) {
        issues.push({
          type: 'status_mismatch',
          fid,
          message: `${fid} 在 REQUIREMENTS.md 中标记为"已完成"，但 PRD-PRODUCT.md 未同步`
        });
      }
    }
  }

  return issues;
}
```

---

## PRD 更新模板

### 章节结构模板

```markdown
### F028 AI 合同审核系统

**业务目标**：降低合同审核门槛，提升审核效率

**用户故事**：销售/商务上传合同文件，系统自动分析风险并生成报告

**核心流程**：
1. 上传合同文件（Word/PDF）→ 已实现 ✅
2. 自动解析文本内容 → 已实现 ✅
3. 本地规则引擎检测 → 已实现 ✅
4. AI 深度分析 → 已实现 ✅
5. 红黄绿三级风险标记 → 已实现 ✅
6. 生成审核报告 → 已实现 ✅

**技术方案**（与实际实现一致）：
- docx-templates + puppeteer (已更新为：mammoth + pdfjs-dist)
- 双引擎：本地规则 + OpenAI API

**验收标准**：
- [x] 支持 Word/PDF 解析
- [x] 规则库可维护
- [x] AI 分析可选
- [x] 报告可导出

**当前状态**：✅ MVP 已完成（2026-05-15）
**闭合度**：75%（待补全模板引擎）
```

---

## 回写流程时序

```
F001 开发完成
     │
     ▼
┌─────────────────┐
│ 1. 代码验收     │
│    - 测试通过   │
│    - 审查通过   │
└───────┬─────────┘
        │
        ▼
┌─────────────────┐
│ 2. 文档回写     │
│    - PRD更新    │
│    - REQ更新    │
└───────┬─────────┘
        │
        ▼
┌─────────────────┐
│ 3. 验证同步     │
│    H008检查通过 │
└───────┬─────────┘
        │
        ▼
┌─────────────────┐
│ 4. 合并+归档    │
│    - CHANGELOG  │
│    - 状态锁定   │
└─────────────────┘
```

---

## 预提交检查集成

```bash
# 添加到 pre-commit hook

# H008: PRD同步检查
echo "Checking PRD synchronization..."
node governance/harness/validators/prd-sync-check.js
if [ $? -ne 0 ]; then
    echo "❌ PRD-PRODUCT.md 与 REQUIREMENTS.md 不同步"
    echo "   请更新 PRD-PRODUCT.md 以反映最新状态"
    exit 2
fi
```

---

## 不一致处理流程

### 发现不一致时

```
问题：F003 在 REQUIREMENTS.md 中"已完成"，
      但 PRD-PRODUCT.md 中仍标记"开发中"

操作：
1. 阻止当前提交
2. 输出不一致详情
3. 提示需要更新 PRD-PRODUCT.md 的哪些章节
```

### 更新优先级

| 不一致类型 | 优先级 | 处理时限 |
|-----------|--------|---------|
| 状态不同步 | P0 | 立即阻止，必须更新 |
| 技术方案过时 | P1 | 本周内更新 |
| 验收标准缺失 | P1 | 本周内补充 |
| 拼写/格式 | P2 | 下次提交时修正 |

---

## 自动化辅助

### 建议更新提示

```bash
# 当检测到代码变更时，提示可能的 PRD 更新点

$ git add product/src/app/quotes/page.tsx

⚠️ 检测到以下文件变更可能影响 PRD:
   - product/src/app/quotes/page.tsx (REQ:F002)

建议检查:
   - PRD-PRODUCT.md 中 F002 章节
   - REQUIREMENTS.md 中 F002 状态
   - 验收标准是否可验证
```

---

**执行检查**（合并前必须）：
- [ ] REQUIREMENTS.md 状态与 PRD-PRODUCT.md 一致
- [ ] 代码中的技术方案与 PRD 描述一致
- [ ] 已完成功能的闭合度已更新
- [ ] CHANGELOG 已生成对应条目
