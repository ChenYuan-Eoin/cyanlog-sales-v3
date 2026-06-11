# REQ-F003: Account (认证与权限)

---
## REQ 元数据
- **ID**: F003
- **名称**: Account (认证与权限)
- **模块**: Account
- **优先级**: P0
- **状态**: completed
- **来源**: Account.md

---
## 业务目标

建立自主可控的认证体系，支持多种身份源，并实现可配置的 RBAC 权限模型。

---
## 核心功能

### 1. 用户认证
- 邮箱/手机号 + 密码登录
- Token 会话管理（JWT + PostgreSQL 存储）
- Token 过期与失效机制

### 2. 角色权限 (RBAC)
- 角色定义与权限配置
- 用户角色分配
- 数据范围隔离 (org_id)

### 3. 飞书集成
- 飞书组织同步
- 用户映射与导入

---
## 实现证据

### 代码位置 (L3)
- `app/api/auth/login/route.ts` - 登录 API
- `app/api/auth/route.ts` - 注册 API
- `lib/auth.ts` - 认证工具
- `lib/supabase.ts` - 数据库连接
- `middleware.ts` - 请求拦截认证
- `app/api/roles/[id]/route.ts` - 角色管理 API
- `app/api/access/feishu/sync/route.ts` - 飞书同步
- `app/configs/page.tsx` - 用户管理 UI

### 数据库层面 (L2)
- `users` 表
- `auth_tokens` 表
- `roles` 表
- `user_roles` 表
- `user_identities` 表（飞书映射）

---
## 验证证据 (L4)

### 测试覆盖
- 单元测试: `lib/auth.test.ts`
- API 测试: `app/api/auth/*.test.ts`
- E2E 测试: `e2e/auth.spec.ts`

### 运行指标
- 登录成功率: > 99%
- Token 过期处理: 自动刷新

---
## 状态: ✅ COMPLETED

该 REQ 已完成实现并上线运行。
