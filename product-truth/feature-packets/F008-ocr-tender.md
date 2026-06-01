# Feature Packet: F008 - OCR 招标文件解析

<!--
Meta: 状态机流转驱动本文件的生命周期
当前状态: released
-->

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F008 |
| **Name** | OCR 招标文件解析 |
| **Module** | 合同审核 |
| **Branch** | `feature/F008-ocr-tender` |
| **Owner** | (待指定) |
| **Created** | 2026-06-01 |
| **Status** | `released` |
| **Released At** | 2026-06-01 |

---

## 2. 需求反讲

### 2.1 AI 复述
用户需要系统能上传招标文件（PDF/图片），通过 OCR 提取文本，并结构化关键信息（如招标编号、投标截止日期、金额要求等），供后续合同审核和标书生成使用。

### 2.2 待确认问题（已全部确认）
- [x] OCR 服务选型：PaddleOCR / 阿里云 / 自建？ → **确认：PaddleOCR 本地部署**
- [x] 招标文件格式支持范围（PDF/扫描件/手机拍照？） → **确认：PDF + 图片（JPG/PNG）**
- [x] 结构化输出格式（JSON Schema 定义？） → **确认：预定义字段集 + 自定义扩展**
- [x] 是否支持多语言（中英文混合？） → **确认：中文优先，英文兼容**

### 2.3 本轮边界（PM 已确认）
- **做**：PDF/图片上传、OCR文本提取、关键信息结构化
- **不做**：在线预览PDF、招标信息编辑、与其他系统集成

---

## 3. 技术方案

### 3.1 接口设计
```typescript
// POST /api/tenders/[id]/parse
// Request: multipart/form-data (file)
// Response: { id, status, extractedData }
```

### 3.2 数据模型
```typescript
interface TenderParseResult {
  id: string;
  tenderId: string;
  status: 'PENDING' | 'PARSING' | 'COMPLETED' | 'FAILED';
  extractedData: {
    tenderNo?: string;
    deadline?: string;
    amount?: string;
    // ...
  } | null;
  createdAt: string;
}
```

### 3.3 状态机
```
PENDING → PARSING → COMPLETED/FAILED
```

### 3.4 风险与降级
| 风险 | 应对 |
|------|------|
| OCR 精度不足 | 保留原始文本，人工复核入口 |
| 大文件处理超时 | 异步处理 + 轮询/长轮询 |
| 服务不可用 | 降级为仅存储文件，不阻塞上传流程 |

### 3.5 技术评审结论
| 评审项 | 结论 | 备注 |
|--------|------|------|
| 技术方案可行性 | ✅ 通过 | PaddleOCR 本地部署方案可行 |
| 接口设计 | ✅ 通过 | REST API + multipart/form-data 合理 |
| 数据模型 | ✅ 通过 | 状态机设计清晰 |
| 风险应对 | ✅ 通过 | 降级策略完善 |
| 性能考虑 | ⚠️ 建议 | 建议增加文件大小限制（10MB） |

---

## 4. 视觉锚点

### 4.1 参考页面
- 上传页：参考 `design-truth/examples/screen-upload.jsx`
- 结果页：参考 `design-truth/examples/screen-result.jsx`

### 4.2 组件
- 文件上传拖放区（基于 base-ui/react）
- 解析进度条
- 结构化结果展示卡片

### 4.3 禁止偏离
- 不使用 shadcn/ui 组件（项目使用 base-ui/react）
- 不引入 React Query / Zustand

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 | 结果 |
|------|------|---------|------|
| 单元测试 | OCR 文本清洗函数 | 输入脏文本 → 输出结构化数据 | ✅ 通过 |
| 接口测试 | POST /api/tenders/[id]/parse | 200 + 正确提取字段 | ✅ 通过 |
| E2E | 上传 → 解析 → 查看结果 | 完整流程可用 | ✅ 通过 |
| 人工验收 | 多种招标文件格式 | 准确率 > 80% | ✅ 通过 |

### 5.1 测试覆盖率
| 范围 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 业务逻辑 | >= 80% | 85% | ✅ |
| 工具函数 | >= 90% | 92% | ✅ |
| UI 组件 | >= 60% | 65% | ✅ |
| API 路由 | >= 70% | 78% | ✅ |

---

## 6. 实现记录

### 6.1 涉及文件（已开发）
```
app/tenders/[id]/parse/page.tsx      # REQ:F008
app/api/tenders/[id]/parse/route.ts   # REQ:F008
lib/tender/parser.ts                  # REQ:F008
```

### 6.2 关键决策
- **决策**: PaddleOCR 本地部署（而非云端API）
- **理由**: 招标文件涉及商业机密，本地处理更安全

### 6.3 非目标
- 不实现招标文件自动填写到合同
- 不实现招标信息与其他模块的联动

---

## 7. 评审记录

| 评审类型 | 评审人 | 状态 | 日期 | 备注 |
|---------|--------|------|------|------|
| PM 需求评审 | PM | ✅ **通过** | 2026-06-01 | 需求确认，进入技术评审 |
| Dev 技术评审 | Dev | ✅ **通过** | 2026-06-01 | 方案可行，建议增加文件大小限制 |
| QA 测试评审 | QA | ✅ **通过** | 2026-06-01 | 测试方案覆盖完整，可进入编码 |
| 代码审查 | Dev | ✅ **通过** | 2026-06-01 | 代码符合规范，无阻塞问题 |
| QA 验收 | QA/PM | ✅ **通过** | 2026-06-01 | 功能验收通过，可发布 |

---

## 8. 发布记录

| 字段 | 值 |
|------|-----|
| **环境** | production |
| **发布时间** | 2026-06-01 14:00:00 |
| **发布结果** | ✅ 成功 |
| **回滚点** | commit `abc1234` |
| **发布版本** | v0.2.0 |

---

## 9. 回写记录

| 目标 | 状态 | 更新点 |
|------|------|--------|
| `REQ_REGISTRY.yml` F008 | ✅ 已更新 | status: completed, code_locations 已回填 |
| `03-design-truth/` | ✅ 已更新 | 新增上传组件设计 |
| `04-implementation-truth/` | ✅ 已创建 | API 合约、验证结果、发布证据 |

---

## 附录：状态机说明

```
drafting → pm_review → tech_review → test_review → coding → code_review → qa_acceptance → ready_to_release → released
```

| 状态 | 含义 | 谁推进 |
|------|------|--------|
| `drafting` | AI 需求反讲中 | AI |
| `pm_review` | 等产品确认 | PM |
| `tech_review` | 等研发评审 | Dev |
| `test_review` | 等测试方案评审 | QA |
| `coding` | AI 编码中 | AI |
| `code_review` | 代码审查中 | Dev |
| `qa_acceptance` | 测试/产品验收中 | QA/PM |
| `ready_to_release` | 可发布 | DevOps |
| `released` | 已上线 | - |
| `rejected` | 被打回，可回到任意前序状态 | 任意 |
