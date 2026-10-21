# REQ-F003: Account (认证与权限)

---
## REQ 元数据
- **ID**: F003
- **名称**: Account (认证与权限)
- **模块**: Account
- **优先级**: P0
- **状态**: in_progress（WP43 角色权限配置修复）
- **来源**: Account.md (已归档)

---
## 业务目标

建立自主可控的认证体系，支持多种身份源，并实现可配置的 RBAC 权限模型。

**关键原则**：
- 自主可控：不依赖 Clerk/Auth0
- 部门树来源：自建为主，飞书为辅
- 权限可配置：当前组织根超管维护组织级权限覆盖；`roles.permissions` 保留为全局模板，不能由组织配置直接改写。

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

**WP43 当前合同（2026-10-21，IN-20261021-013）**：

- 一个用户任务：组织根超管在配置中心编辑系统角色权限，保存后当前组织的授权检查使用新权限。
- 使用既有 `organizations.settings.role_permission_overrides[roleId] = string[]` 保存组织覆盖。覆盖存在时完整替换模板权限；空数组表示无权限，不能回退模板；其他组织继续使用各自覆盖或模板。
- 只有绑定当前组织的 `SUPER_ADMIN` 且仍有权限管理能力的用户可修改；普通管理员或只有 `config:write` 的用户不能修改角色授权。根账户身份保护与成员分配限制保持有效。
- 超管可收紧非核心业务权限，保留 `admin:access`、`config:read`、`config:write`、`role:manage` 四项核心权限，以便恢复配置。核心限制须在表单说明并由服务端校验。
- 取消细项时须消除覆盖该细项的 `*` 或资源通配符，并保留其他已授予能力；不得出现页面取消勾选后服务端仍放行的结果。
- 保存须保留其他组织设置，并以比较原 settings 的方式检测并发冲突；冲突返回 409，用户可刷新后继续编辑。
- Middleware、API 包装器、组织权限、合同/问答/寄件连接授权与工作台数据范围使用同一有效权限；覆盖后的角色名称不能重新补入已撤销能力。新请求须重新读取组织覆盖，不能由进程内缓存继续放行。
- 自定义角色创建、复制和命名留待后续批次。当前目标为 `code_green`，推送、PR、Production 发布和生产权限数据变更须另行授权；代码验证不能表达为线上已修复。

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

### 角色权限接口（WP43）
| 接口 | 方法 | 路径 | 权限要求 |
|------|------|------|----------|
| 获取角色列表 | GET | /api/roles | 当前组织配置读取或组织管理；返回组织有效权限和可编辑状态 |
| 更新角色权限 | PATCH | /api/roles/:id | 当前组织根超管和权限管理能力；只保存当前组织覆盖 |
| 分配用户角色 | POST | /api/admin/users/:id/roles | 既有成员管理和委派上限校验；根角色保护保持有效 |

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
| 10 | 超级管理员 | 当前组织的 SUPER_ADMIN 角色 | 编辑并保存非核心权限 | 当前组织有效权限生效，四项恢复配置核心权限保持 |
| 11 | 飞书首次登录 | 用户未绑定飞书 | 飞书扫码 | 自动注册本地用户 |
| 12 | 组织隔离 | 组织 A 和 B 使用同一角色模板 | A 保存角色覆盖 | B 的权限和全局模板不变 |
| 13 | 降权生效 | 覆盖撤销某业务权限 | 已登录用户发起下一次受保护请求 | Middleware/API 拒绝对应操作，角色码不能绕过 |
| 14 | 无权限与通配符 | 角色原有资源通配符或覆盖为空 | 取消其中细项或保存空覆盖 | 被撤销能力不可访问，其余保留能力与表单一致 |
| 15 | 并发保存 | 两名超管读取同一 settings 版本 | 先后保存角色覆盖 | 后提交者收到 409，已有更新不被覆盖 |
| 16 | 越权与防锁死 | 普通管理员或非法核心权限输入 | 直接调用角色 PATCH | 拒绝越权或核心撤销，不修改组织权限 |

---
## 交付状态

历史认证实现保留。WP43 角色配置修复正在执行，验证记录写入工作树独立的 `codex-runtime`；本合同不声称本次修复已发布或通过 Production 验收。
