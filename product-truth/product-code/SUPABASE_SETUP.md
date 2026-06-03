# Supabase 手动设置指南

> **为什么需要手动？** Supabase pg 直连需要 database password，service_role JWT 不能作为 pg 密码。CLI 需要 `sbp_` 格式的 access token。

## 一键执行：登录 Dashboard → SQL Editor → 粘贴运行

**链接**：https://supabase.com/dashboard/project/wfawwhphfqqwfwrrkogy/sql/new

按顺序粘贴并运行以下 7 个 SQL 迁移：

### 1. login_attempts（防爆破支撑表）
文件：`supabase/migrations/20260602000002_add_login_attempts.sql`

### 2. error_logs（自托管错误追踪表）
文件：`supabase/migrations/20260602000003_add_error_logs.sql`

### 3. case_library（F015 案例库）
文件：`supabase/migrations/20260602000004_add_case_library.sql`

### 4. tech_documents（F016 技术文档库）
文件：`supabase/migrations/20260602000005_add_tech_documents.sql`

### 5. business_qualifications（F017 商务资质库）
文件：`supabase/migrations/20260602000006_add_business_qualifications.sql`

### 6. agenda_items + reminder_rules + reminders（F018+F019 日程+提醒）
文件：`supabase/migrations/20260602000007_add_agenda.sql`

## 顺序

按文件名前缀的 timestamp 顺序执行：
- `20260602000002_` (login_attempts)
- `20260602000003_` (error_logs)
- `20260602000004_` (case_library)
- `20260602000005_` (tech_documents)
- `20260602000006_` (business_qualifications)
- `20260602000007_` (agenda)

## 验证

执行后跑：

```bash
# 在 project-code 目录
node --env-file=.env.local scripts/setup-e2e-user.mjs
```

应该看到 E2E 用户创建/更新成功。

## 已有数据

如果生产环境已有数据，迁移使用 `CREATE TABLE IF NOT EXISTS`，不会破坏现有表。

## 提醒规则默认种子（F019）

迁移 `20260602000007_` 创建了 reminder_rules 表（结构），但默认规则需要手动插入：

```sql
-- 默认提醒：所有日程开始前 30 分钟 IN_APP 提醒
INSERT INTO reminder_rules (name, agenda_type, trigger_offset_minutes, channel, is_active)
VALUES ('默认提前 30 分钟', NULL, 30, 'IN_APP', TRUE)
ON CONFLICT DO NOTHING;
```

> 注意：ON CONFLICT 需要先给 reminder_rules 加唯一约束。如果上面 SQL 报错说没冲突目标，可改为 `INSERT ... WHERE NOT EXISTS` 或先 SELECT 查重。
