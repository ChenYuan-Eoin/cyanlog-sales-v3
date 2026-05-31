# Feature Packet: F005-合同详情页

**Created**: 2026-05-31  
**REQ ID**: F005  
**Status**: completed

---

## 1. 单元定义

**目标**: 让用户能查看合同详情和AI审核结果，完成 上传→查看结果 闭环

**边界**:
- 只做详情展示，不做编辑
- 只做AI审核触发，不做实时进度推送（轮询刷新）

**本轮不做什么**:
- 不实现真正的OCR解析（当前是模拟）
- 不做合同文件预览（PDF/Word在线预览）
- 不做审核报告导出
- 不修改报价中心或其他模块

---

## 2. 双锚点

### 业务锚点
- 合同状态: PENDING → PARSING → ANALYZING → COMPLETED/FAILED
- 审核触发: POST /api/contracts/[id]/analyze
- 审核结果格式:
  ```typescript
  {
    risks: [{ level: 'red'|'yellow'|'green', title, description, suggestion }],
    summary: string
  }
  ```
- 权限: 只能查看自己创建的合同

### 视觉锚点
- 参考: `design-truth-设计真相层/examples/screen-approval.jsx`
- 布局: header + info card + result card
- 状态可视化: Badge 组件显示状态
- 风险等级: 红黄绿三色卡片区分

---

## 3. 涉及文件

**新建**:
- `app/contracts/[id]/page.tsx` (REQ:F005)

**修改**:
- `app/contracts/page.tsx` - 修正 loading 状态位置

---

## 4. 新增约束（本轮发现）

### 状态机规则
| 状态 | 用户可见 | 可操作 |
|------|----------|--------|
| PENDING | 待审核 | 开始AI审核 |
| PARSING | 解析中 | 无（自动流转） |
| ANALYZING | 审核中 | 无（自动流转） |
| COMPLETED | 审核完成 | 查看结果 |
| FAILED | 审核失败 | 重新审核 |

### API 约束
- analyze API 是异步触发，不等待完成
- 触发后需刷新获取最新状态
- 24小时内幂等控制（后端已实现）

### UI 约束
- 加载状态必须包含操作按钮（让用户知道可以上传）
- error 状态必须有返回入口
- 风险项必须显示：等级、标题、描述、建议

### 代码规范约束
- catch 块不使用 err 参数时要省略（lint规则）
- 新文件必须有 REQ 标记

---

## 5. 遗留问题

- [ ] 真实AI审核接入（当前是模拟延迟）
- [ ] 合同文件在线预览
- [ ] 审核历史记录展示（当前只显示最新）
- [ ] 合同编辑功能
- [ ] 批量操作（批量删除、批量审核）

---

## 6. 验证记录

- [x] `pnpm lint` 通过
- [x] `pnpm tsc --noEmit` 通过
- [x] `pnpm build` 通过，新路由生成
- [x] `pre-commit hooks` 通过
- [ ] 浏览器实际验证（待人工验证）

---

## 7. 代码位置回填

已更新 `product-truth/REQ_REGISTRY.yml` F005:
```yaml
code_locations:
  - app/api/contracts/route.ts
  - app/api/contracts/[id]/route.ts
  - app/api/contracts/[id]/analyze/route.ts
  - app/contracts/page.tsx
  - app/contracts/new/page.tsx
  - app/contracts/[id]/page.tsx  # 本次新增
```
