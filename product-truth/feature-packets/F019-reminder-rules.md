# Feature Packet: F019-提醒规则

**REQ ID**: F019  
**Status**: draft → design_in_progress  
**Priority**: P2  
**Upstream**: 日程管理.md (已归档)

---

## 1. 目标

可配置的提醒规则引擎，支持业务事件触发提醒。

## 2. 规则配置

```yaml
rules:
  - name: 报价跟进提醒
    trigger: quote.status = SENT
    delay: 3d
    channel: [app, feishu]
    template: "报价 {{quote.no}} 已发送3天，请跟进"

  - name: 审批超时提醒
    trigger: approval.timeout - 2h
    channel: [app, feishu, email]
    template: "审批即将超时，请尽快处理"
```

## 3. 触发方式

| 方式 | 说明 |
|------|------|
| 状态触发 | 业务状态变更时 |
| 时间触发 | 到达指定时间 |
| 周期触发 | 按周期重复 |

## 4. 提醒通道

| 通道 | 优先级 |
|------|--------|
| 应用内 | P0 |
| 飞书 | P0 |
| 邮件 | P1 |
| 短信 | P2 |

## 5. MVP 范围

- [ ] 规则配置
- [ ] 规则引擎
- [ ] 多通道发送
