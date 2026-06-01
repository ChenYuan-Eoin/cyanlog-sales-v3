# Feature Packet: F004-三级审批

**Created**: 2026-06-01  
**REQ ID**: F004  
**Status**: in_progress  
**Parent**: 报价中心

---

## 1. 单元定义

**目标**: 实现报价单的审批流程引擎，支持三级审批

**审批层级**:
- 第一级：销售经理审批（折扣 < 5%）
- 第二级：区域总监审批（折扣 5-10%）
- 第三级：总经理审批（折扣 > 10%）

**审批动作**:
- 通过 - 进入下一级或最终确认
- 驳回 - 退回给报价人修改
- 转交 - 转给其他审批人

**本轮不做什么**:
- 不实现复杂的会签/并签
- 不做审批超时提醒（F019）
- 不做审批委托代理

---

## 2. 状态机

```
DRAFT (草稿)
  ↓ submit
PENDING_LEVEL1 (一级审批中)
  ↓ approve → PENDING_LEVEL2 (二级审批中)
  ↓ reject → REJECTED
PENDING_LEVEL2 (二级审批中)
  ↓ approve → PENDING_LEVEL3 (三级审批中)
  ↓ reject → REJECTED
PENDING_LEVEL3 (三级审批中)
  ↓ approve → APPROVED
  ↓ reject → REJECTED
REJECTED (已驳回)
  ↓ resubmit → PENDING_LEVEL1
APPROVED (已通过)
```

---

## 3. 涉及文件

**新建**:
- `app/api/approvals/route.ts` - 审批列表 API
- `app/api/approvals/[id]/route.ts` - 审批详情/操作 API
- `app/approvals/page.tsx` - 审批中心页面
- `lib/approval/workflow.ts` - 审批工作流引擎

**修改**:
- `app/quotes/[id]/page.tsx` - 集成审批状态显示

---

## 4. 数据模型

```sql
-- 审批记录
CREATE TABLE approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID REFERENCES quotes(id),
    level INT NOT NULL, -- 1, 2, 3
    approver_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending', -- pending/approved/rejected
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- 审批配置
CREATE TABLE approval_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level INT NOT NULL,
    max_discount DECIMAL(5, 2), -- 最大折扣率
    approver_role VARCHAR(50)
);
```
