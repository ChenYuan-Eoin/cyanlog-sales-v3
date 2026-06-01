# Feature Packet: F002-报价编制维护

**Created**: 2026-06-01  
**REQ ID**: F002  
**Status**: in_progress  
**Parent**: 报价中心

---

## 1. 单元定义

**目标**: 完善报价编制功能，补齐缺失的详情页和状态流转

**当前已实现**:
- ✅ 报价列表页
- ✅ 新建报价表单
- ✅ 报价 API（列表+创建）

**缺失功能**:
- ❌ 报价详情页
- ❌ 状态流转（草稿→审批中→已批准/已驳回）
- ❌ 操作按钮（编辑、提交审批）

**本轮不做什么**:
- 不做三级审批完整流程（F004）
- 不做折扣计算
- 不做价盘管理（F001）

---

## 2. 双锚点

### 业务锚点
- 报价状态：DRAFT → PENDING_APPROVAL → APPROVED/REJECTED
- 审批触发：用户点击"提交审批"
- 审批结果：审批人通过或驳回

### 视觉锚点
- 复用合同详情页布局（Card + Badge）
- 状态用 Badge 区分
- 操作按钮在基本信息卡片下方

---

## 3. 涉及文件

**新建**:
- `app/quotes/[id]/page.tsx` - 报价详情页

**修改**:
- `app/quotes/page.tsx` - 添加"查看"链接
- `app/api/quotes/[id]/route.ts` - 添加更新/审批 API

---

## 4. 状态机

| 状态 | 说明 | 可执行操作 |
|------|------|-----------|
| DRAFT | 草稿 | 编辑、提交审批 |
| PENDING_APPROVAL | 审批中 | 审批通过、审批驳回 |
| APPROVED | 已批准 | 查看 |
| REJECTED | 已驳回 | 重新编辑、重新提交 |

---

## 5. 验证记录

- [ ] 报价详情页正常显示
- [ ] 状态流转操作正常
- [ ] Badge 颜色正确

---

## 6. 代码位置

更新 `REQ_REGISTRY.yml` F002:
```yaml
code_locations:
  - app/api/quotes/route.ts
  - app/api/quotes/[id]/route.ts
  - app/quotes/page.tsx
  - app/quotes/new/page.tsx
  - app/quotes/[id]/page.tsx
```
