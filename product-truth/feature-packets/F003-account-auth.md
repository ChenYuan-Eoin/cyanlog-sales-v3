# REQ-F003: Account (认证与权限)

---
## REQ 元数据
- **ID**: F003
- **名称**: Account (认证与权限)
- **模块**: Account
- **优先级**: P0
- **状态**: completed
- **来源**: Account.md (已归档)

---
## 业务目标

建立自主可控的认证体系，支持多种身份源，并实现可配置的 RBAC 权限模型。

**关键原则**：
- 自主可控：不依赖 Clerk/Auth0
- 部门树来源：自建为主，飞书为辅
- 权限可配置：管理员编辑 `roles.permissions`，改完立即生效

---
## 核心功能

### 1. 用户认证
- 邮箱/手机号 + 密码登录
- Token 会话管理（JWT + PostgreSQL 存储）
- Token 过期与失效机制

**登录方式优先级**：
| 方式 | 优先级 | 说明 |
|------|--------|------|
| 手机号+密码 | P0 | 主要方式 |
| 邮箱+密码 | P0 | 备用方式 |
| 手机号+验证码 | P1 | 快捷登录 |
| 飞书扫码 | P1 | 首次登录自动注册 |

### 2. 角色权限 (RBAC)

**两层模型**：User → Role → Permission

**内置角色**：
| 角色 | code | 默认权限 |
|------|------|----------|
| 超级管理员 | SUPER_ADMIN | *（所有权限） |
| 销售经理 | SALES_MANAGER | quote:*, contract:view, customer:* |
| 销售 | SALES | quote:create, quote:update_own, contract:view |
| 法务 | LEGAL | contract:*, quote:view, customer:view |
| 销售运营 | SALES_OPS | config:*, user:view, role:view, report:* |
| 财务 | FINANCE | quote:view, contract:view, payment:* |
| 只读用户 | READONLY | quote:view, contract:view, customer:view |

**权限 Key 清单（13个）**：
```
config:read / config:write
rule:write
contract:read / contract:write / contract:review
quote:read / quote:write
user:read / user:write
org:write
feishu:sync
admin:access
```

### 3. 飞书集成
- 飞书组织同步
- 用户映射与导入
- 仅限 SUPER_ADMIN 可操作

---
## 数据模型

```sql
-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid VARCHAR(8) UNIQUE DEFAULT generate_ulid(),
  email VARCHAR(128) UNIQUE,
  phone VARCHAR(32) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(64) NOT NULL,
  name_pinyin VARCHAR(128),
  avatar VARCHAR(255),
  role_id VARCHAR(8) REFERENCES roles(uuid),
  status VARCHAR(16) DEFAULT 'ACTIVE', -- ACTIVE/INACTIVE/DISABLED
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 认证 Token 表
CREATE TABLE auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(128) UNIQUE NOT NULL,
  user_id VARCHAR(8) REFERENCES users(uuid),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---
## API 接口清单

### 认证接口
| 接口 | 方法 | 路径 | 权限 |
|------|------|------|------|
| 用户注册 | POST | /api/auth/register | - |
| 用户登录 | POST | /api/auth/login | - |
| 用户登出 | POST | /api/auth/logout | 需 token |
| 获取当前用户 | GET | /api/auth/me | 需 token |
| 修改密码 | POST | /api/auth/password | 需 token |
| 飞书回调 | GET | /api/auth/feishu/callback | - |

### 用户管理接口
| 接口 | 方法 | 路径 | 权限要求 |
|------|------|------|----------|
| 创建用户 | POST | /api/admin/users | user:create |
| 更新用户 | PUT | /api/admin/users/:id | user:update |
| 删除用户 | DELETE | /api/admin/users/:id | user:delete |
| 用户列表 | GET | /api/admin/users | user:list |

### 角色权限接口
| 接口 | 方法 | 路径 | 权限要求 |
|------|------|------|----------|
| 获取角色列表 | GET | /api/admin/roles | role:list |
| 更新角色权限 | PUT | /api/admin/roles/:id/permissions | role:update |
| 分配用户角色 | POST | /api/admin/users/:id/role | user:assign_role |

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
## 验收标准

| # | 场景 | 给定 | 当 | 那么 |
|---|------|------|-----|------|
| 1 | 用户注册 | 邮箱未注册 | 调用注册接口 | 创建用户，返回用户信息和 token |
| 2 | 重复注册 | 邮箱已存在 | 调用注册接口 | 返回 409，提示邮箱已注册 |
| 3 | 正常登录 | 用户存在且密码正确 | 调用登录接口 | 返回 token 和完整用户信息 |
| 4 | 密码错误 | 用户存在但密码错误 | 调用登录接口 | 返回 401，提示认证失败 |
| 5 | 用户禁用 | 用户状态为 DISABLED | 调用登录接口 | 返回 401，提示账户已禁用 |
| 6 | Token 验证 | 请求携带有效 token | 访问受保护接口 | 正常响应 |
| 7 | Token 无效 | 请求携带无效 token | 访问受保护接口 | 返回 401 |
| 8 | 权限检查 | 用户有 quote:create 权限 | 创建报价 | 允许创建 |
| 9 | 权限拒绝 | 用户无 quote:create 权限 | 创建报价 | 返回 403，权限不足 |
| 10 | 超级管理员 | SUPER_ADMIN 角色 | 访问任何接口 | 全部允许 |
| 11 | 飞书首次登录 | 用户未绑定飞书 | 飞书扫码 | 自动注册本地用户 |

---
## 状态: ✅ COMPLETED

该 REQ 已完成实现并上线运行。
