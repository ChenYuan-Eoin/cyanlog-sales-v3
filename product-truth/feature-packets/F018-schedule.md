# Feature Packet: F018-日程管理

**REQ ID**: F018  
**Status**: draft → design_in_progress  
**Priority**: P2  
**Upstream**: 日程管理.md (已归档)

---

## 1. 目标

日程中心，聚合业务触发的待办和手动创建的日程。

## 2. 日程类型

| 类型 | 触发条件 | 默认提醒 |
|------|---------|----------|
| 报价跟进 | 报价发送后3天 | 应用内+飞书 |
| 报价到期 | 有效期前3天 | 应用内+飞书 |
| 合同审核 | 审核完成 | 应用内 |
| 客户拜访 | 手动创建 | 开始前1小时 |
| 审批超时 | 超时前2小时 | 应用内+飞书+邮件 |
| 资质到期 | 到期前30天 | 应用内+飞书+邮件 |

## 3. 视图类型

- 日视图、周视图、月视图、列表视图

## 4. 数据模型

```sql
CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type TEXT, -- quote_follow/contract_review/customer_visit/...
  status TEXT DEFAULT 'pending',
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  remind_at TIMESTAMPTZ,
  related_id UUID, -- 关联业务ID
  user_id UUID NOT NULL
);
```

## 5. MVP 范围

- [ ] 日程 CRUD
- [ ] 日历视图
- [ ] 提醒通知
