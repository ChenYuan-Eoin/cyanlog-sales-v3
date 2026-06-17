# Feature Packet: F015-案例库管理

**REQ ID**: F015  
**Status**: draft → design_in_progress  
**Priority**: P2  
**Upstream**: 知识库管理.md (已归档)

---

## 1. 目标

建立案例库，积累赢单/丢单经验，支持销售决策。

## 2. 案例分类

| 维度 | 选项 |
|------|------|
| 行业 | 金融/政府/医疗/教育/企业 |
| 产品 | 安全/云/大数据/AI |
| 难度 | 简单/中等/复杂 |
| 结果 | 成功/失败 |

## 3. 案例模板

```
案例名称：
客户名称：
行业/产品/金额/周期：

背景：
挑战：
解决方案：
关键成功因素：
结果：
经验教训：
```

## 4. 数据模型

```sql
CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  customer_name TEXT,
  industry TEXT,
  product TEXT,
  amount DECIMAL(15,2),
  result TEXT CHECK (result IN ('success', 'failure')),
  background TEXT,
  challenge TEXT,
  solution TEXT,
  lessons TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 5. MVP 范围

- [ ] 案例 CRUD
- [ ] 按分类筛选
- [ ] 全文搜索
