# 脚本说明

## 唯一 Seed 入口

```bash
export SUPABASE_SERVICE_ROLE_KEY=eyJ...
pnpm db:seed
```

这会插入：组织、角色、部门、用户、用户-角色、用户-部门、销售空间、空间成员、客户、机会、节点、提醒、日程、规则、产品。

数据：3个产品、10条红绿灯规则、21个测试账号、8个客户/机会、3个销售空间。

**不要新增 seed 脚本。** 如需扩展，复用 `scripts/seed-via-api.mjs`。

## 一次性工具（不建议常用）

- `fix-uuids.mjs` — UUID 修复（历史遗留）
- `setup-e2e-user.mjs` — E2E 测试用户
- `test-pg-conn.mjs` — PG 连接诊断
- `verify.mjs` — 验证

## 已弃用（待清理）

- `apply-migrations.mjs` / `apply-migrations-api.mjs` — 重复，建议用 Supabase CLI
- `deploy.sh` — 引用废弃的 Prisma，违反 ADR-008

## 快速开始

### 前置条件
1. 已完成所有数据库迁移（`supabase/migrations/*.sql`）
2. 已配置环境变量 `SUPABASE_SERVICE_ROLE_KEY`

### 运行方式

#### 方式1：Node.js脚本（推荐）
```bash
export SUPABASE_SERVICE_ROLE_KEY=eyJ...
pnpm db:seed
```

#### 方式2：Supabase SQL Editor
1. 打开 Supabase Dashboard → SQL Editor
2. 复制 `supabase/seed.sql` 内容
3. 执行

## Seed 数据清单

### 用户（21个真实测试账号）
| 邮箱 | 角色 | 姓名 | 部门 |
|------|------|------|------|
| superadmin@huarun.com | SUPER_ADMIN | 系统超管 | - |
| admin@huarun.com | ADMIN | 王管理 | IT |
| east.lead@huarun.com | SALES_MANAGER | 李华东 | 华东销售 |
| zhang.ym@huarun.com | SALES | 张一鸣 | 华东·医药 |
| li.fy@huarun.com | SALES | 李芳颖 | 华东·医药 |
| wang.zy@huarun.com | SALES | 王志远 | 华东·零售 |
| chenhj@huarun.com | SALES_MANAGER | 陈慧娟 | 华东·零售 |
| liu.jh@huarun.com | SALES | 刘建华 | 华东·互联网 |
| zhao.mn@huarun.com | SALES | 赵美娜 | 华东·互联网 |
| ... | ... | ... | ... |
| legal01@huarun.com | LEGAL | 陈法务 | 法务部 |
| finance01@huarun.com | FINANCE | 钱会计 | 财务部 |

**默认密码**：`Cyanlog2026!`（由 seed-rules.ts 生成的新hash）

### 合同审核规则（10条）

#### 结构化规则（6条）
- 账期超过90天 → 🔴 红
- 违约金比例超过5% → 🟡 黄
- 保密期超过5年 → 🟡 黄
- 预付款超过30% → 🟡 黄
- 未约定管辖法院 → 🟡 黄
- 未约定违约金 → 🟡 黄

#### 语义规则（4条）
- 责任划分不清晰 → 🟡 黄
- 知识产权归属不明 → 🔴 红
- 数据安全条款缺失 → 🔴 红
- 不可抗力范围过宽 → 🟡 黄

### 产品（3个）
- PROD-001 智能合同审核系统 (¥98,000)
- PROD-002 销售管理平台 (¥50,000)
- PROD-003 AI客服系统 (¥120,000)

### 业务数据
- 8个客户
- 8个机会
- 8个硬节点
- 7条提醒
- 4个日程

## 验证步骤

### 1. 启动开发服务器
```bash
pnpm dev
```

### 2. 浏览器访问
```
http://localhost:3000/login
```

### 3. 使用测试账号登录
```
邮箱: superadmin@huarun.com
密码: Cyanlog2026!
```

### 4. 验证功能
- ✅ 首页：显示今日优先队列、统计卡
- ✅ /products：看到3个测试产品
- ✅ /configs：看到10条合同规则
- ✅ /quotes：创建新报价
- ✅ /contracts：上传合同触发AI审核

## 故障排查

### 错误：permission denied for table users
**原因**：Service Role Key 配置错误
**解决**：
1. 确认 `SUPABASE_SERVICE_ROLE_KEY` 是 service_role 角色
2. 不是 anon 角色

### 错误：duplicate key value violates unique constraint
**原因**：seed 数据已存在
**解决**：脚本使用 `upsert`，应该自动处理。如仍失败，先清空相关表。

### 错误：null value in column "primary_dept_id" violates not-null constraint
**原因**：用户表要求 `primary_dept_id` 非空
**解决**：运行 `supabase/seed.sql` 先创建部门树

## 重置数据

如果需要重置所有数据：
```sql
-- 在 Supabase SQL Editor 中执行
TRUNCATE TABLE
  rules, products, quote_items, quotes, contracts, milestones,
  reminders, agenda_items, opportunities, customers,
  sales_space_members, sales_spaces, user_roles, user_departments,
  users, departments, roles, organizations
RESTART IDENTITY CASCADE;
```

然后重新运行迁移 + seed。
