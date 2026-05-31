---
doc_id: account
doc_name: Account.md
source_doc: PROJECT-主文档.md
source_chapter: 第3章 Account（认证与权限）
source_range: "2139-2596"
generated_at: 2026-05-31
version: "1.0.0"
status: active
module: account
priority: P0
---

# Account（认证与权限）

## 目录

- 1. Account 定义
- 2. 认证机制
- 3. 权限模型（RBAC）
- 4. 数据模型
- 5. API 接口
- 6. 验收标准

---

## 1. Account 定义

**Account = 认证(Authentication) + 鉴权(Authorization)**

- **认证**：验证用户身份（你是谁）→ 登录、Token、Session
- **鉴权**：验证用户权限（你能做什么）→ 角色、权限、资源访问控制
- 英文统一用 **Account**，不再区分"认证中心"和"权限中心"

## 2. 认证机制

### 2.1 自建 Token 认证

- Token 由后端生成，存储于数据库
- 用户修改密码或登出时失效
- HTTP Header 传递：`X-Auth-Token` + `X-User-Id`
- 支持邮箱+密码 或 手机号+密码登录（二选一，同时存在时邮箱优先）

### 2.2 登录方式（不锁死飞书）

| 方式 | 优先级 | 说明 |
|------|--------|------|
| 手机号+密码 | P0 | 主要登录方式 |
| 邮箱+密码 | P0 | 备用登录方式 |
| 手机号+验证码 | P1 | 快捷登录 |
| 飞书扫码 | P1 | 第三方认证，首次登录自动注册 |
| 邮箱+验证码 | P2 | 备用快捷登录 |

### 2.3 第三方认证（预留扩展）

- 飞书（当前接入）
- 钉钉（预留）
- 企业微信（预留）

**第三方登录流程**：
1. 用户点击"飞书扫码登录"
2. 跳转飞书授权页面
3. 飞书回调 `GET /api/auth/feishu/callback`
4. 系统获取飞书用户信息（openid, union_id, name, email, phone, avatar）
5. 查找或创建本地用户
6. 生成自有 JWT Token
7. 登录成功

## 3. 权限模型（RBAC）

### 3.1 两层权限模型

```
User（用户） → 拥有一个 → Role（角色）
Role（角色） → 拥有一组 → Permission（权限点）
```

### 3.2 系统内置角色

| 角色 | code | 默认权限 |
|------|------|----------|
| 超级管理员 | SUPER_ADMIN | *（所有权限） |
| 销售经理 | SALES_MANAGER | quote:*, contract:view, customer:*, report:view |
| 销售 | SALES | quote:create, quote:update_own, contract:view, customer:view |
| 法务 | LEGAL | contract:*, quote:view, customer:view |
| 销售运营 | SALES_OPS | config:*, user:view, role:view, report:* |
| 财务 | FINANCE | quote:view, contract:view, payment:*, report:view |
| 只读用户 | READONLY | quote:view, contract:view, customer:view |

### 3.3 权限点列表

#### 报价中心权限

| 权限代码 | 名称 | 说明 |
|----------|------|------|
| quote:create | 创建报价 | 允许创建新报价单 |
| quote:update | 编辑报价 | 允许编辑任何报价 |
| quote:update_own | 编辑自己的报价 | 仅允许编辑自己创建的报价 |
| quote:delete | 删除报价 | 允许删除任何报价 |
| quote:view | 查看报价 | 允许查看报价详情 |
| quote:approve | 审批报价 | 允许审批报价折扣 |
| quote:export | 导出报价 | 允许导出报价PDF |

#### 合同审核权限

| 权限代码 | 名称 | 说明 |
|----------|------|------|
| contract:create | 上传合同 | 允许上传新合同 |
| contract:review | 审核合同 | 允许执行AI审核 |
| contract:view | 查看合同 | 允许查看合同详情和审核结果 |
| contract:delete | 删除合同 | 允许删除合同 |
| contract:config | 配置审核规则 | 允许修改红绿灯规则 |

#### 系统管理权限

| 权限代码 | 名称 | 说明 |
|----------|------|------|
| user:create | 创建用户 | 允许创建新用户 |
| user:update | 编辑用户 | 允许编辑用户信息 |
| user:delete | 删除用户 | 允许删除用户 |
| user:view | 查看用户 | 允许查看用户列表 |
| user:assign_role | 分配角色 | 允许为用户分配角色 |
| role:create | 创建角色 | 允许创建自定义角色 |
| role:update | 编辑角色 | 允许修改角色权限 |
| role:delete | 删除角色 | 允许删除自定义角色 |
| role:list | 查看角色 | 允许查看角色列表 |
| config:* | 系统配置 | 允许修改系统配置 |

## 4. 数据模型

### 4.1 User（用户）

```prisma
model User {
  id            String     @id @default(cuid())
  uuid          String     @unique @default(uuid()) @db.VarChar(8)
  email         String?    @unique @db.VarChar(128)
  phone         String?    @unique @db.VarChar(32)
  passwordHash  String     @db.VarChar(255)  // bcrypt hash
  name          String     @db.VarChar(64)
  namePinyin    String?    @db.VarChar(128)  // 拼音，用于搜索
  avatar        String?    @db.VarChar(255)  // 头像URL
  roleId        String     @db.VarChar(8)
  role          Role       @relation(fields: [roleId], references: [uuid])
  status        UserStatus @default(ACTIVE)
  lastLoginAt   DateTime?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  @@index([email])
  @@index([phone])
  @@index([roleId])
}

enum UserStatus {
  ACTIVE    // 正常
  INACTIVE  // 未激活
  DISABLED  // 已禁用
}
```

### 4.2 AuthToken

```prisma
model AuthToken {
  id        String   @id @default(cuid())
  token     String   @unique @db.VarChar(128)  // 随机字符串
  userId    String   @db.VarChar(8)
  user      User     @relation(fields: [userId], references: [uuid])
  expiresAt DateTime? // null表示永不过期
  createdAt DateTime @default(now())

  @@index([token])
  @@index([userId])
}
```

### 4.3 Role（角色）

```prisma
model Role {
  uuid        String       @id @db.VarChar(8)
  name        String       @db.VarChar(32)  // 角色名称
  namePinyin  String?      @db.VarChar(64)
  description String?      @db.VarChar(255)
  isSystem    Boolean      @default(false)  // 系统内置角色不可删除
  permissions Permission[] // 角色拥有的权限
  users       User[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}
```

### 4.4 Permission（权限点）

```prisma
model Permission {
  uuid        String   @id @db.VarChar(8)
  code        String   @unique @db.VarChar(64)   // 权限点代码，如"quote:create"
  name        String   @db.VarChar(64)           // 权限名称
  module      String   @db.VarChar(32)           // 所属模块
  description String?  @db.VarChar(255)
  roles       Role[]
  createdAt   DateTime @default(now())
}
```

## 5. API 接口

### 5.1 认证接口

| 接口 | 方法 | 路径 | 输入 | 输出 | 状态码 |
|------|------|------|------|------|--------|
| 用户注册 | POST | /api/auth/register | email, phone, password, name | user, token | 200/400/409 |
| 用户登录 | POST | /api/auth/login | email?, phone?, password | user, token | 200/401 |
| 用户登出 | POST | /api/auth/logout | X-Auth-Token Header | success | 200/401 |
| 获取当前用户 | GET | /api/auth/me | X-Auth-Token Header | user | 200/401 |
| 修改密码 | POST | /api/auth/password | oldPassword, newPassword | success | 200/400/401 |
| 飞书扫码登录 | GET | /api/auth/feishu/login | - | redirect | 302 |
| 飞书回调 | GET | /api/auth/feishu/callback | code | user, token | 200/400 |

### 5.2 用户管理接口（管理员）

| 接口 | 方法 | 路径 | 权限要求 |
|------|------|------|----------|
| 创建用户 | POST | /api/admin/users | user:create |
| 更新用户信息 | PUT | /api/admin/users/:id | user:update |
| 删除用户 | DELETE | /api/admin/users/:id | user:delete |
| 获取用户列表 | GET | /api/admin/users | user:list |
| 重置用户密码 | POST | /api/admin/users/:id/reset-password | user:reset_password |

### 5.3 角色权限接口（管理员）

| 接口 | 方法 | 路径 | 权限要求 |
|------|------|------|----------|
| 创建角色 | POST | /api/admin/roles | role:create |
| 更新角色权限 | PUT | /api/admin/roles/:id/permissions | role:update |
| 删除角色 | DELETE | /api/admin/roles/:id | role:delete |
| 获取角色列表 | GET | /api/admin/roles | role:list |
| 为用户分配角色 | POST | /api/admin/users/:id/role | user:assign_role |

## 6. 验收标准

| # | 场景 | 给定 | 当 | 那么 |
|---|------|------|-----|------|
| 1 | 用户注册 | 邮箱未注册 | 调用注册接口 | 创建用户，返回用户信息和token |
| 2 | 重复注册 | 邮箱已存在 | 调用注册接口 | 返回409，提示邮箱已注册 |
| 3 | 正常登录 | 用户存在且密码正确 | 调用登录接口 | 返回token和完整用户信息 |
| 4 | 密码错误 | 用户存在但密码错误 | 调用登录接口 | 返回401，提示认证失败 |
| 5 | 用户禁用 | 用户状态为DISABLED | 调用登录接口 | 返回401，提示账户已禁用 |
| 6 | Token验证 | 请求携带有效token | 访问受保护接口 | 正常响应 |
| 7 | Token无效 | 请求携带无效token | 访问受保护接口 | 返回401 |
| 8 | Token登出 | 用户已登出 | 使用旧token访问 | 返回401，提示令牌已失效 |
| 9 | 权限检查 | 用户有quote:create权限 | 创建报价 | 允许创建 |
| 10 | 权限拒绝 | 用户无quote:create权限 | 创建报价 | 返回403，权限不足 |
| 11 | 超级管理员 | 用户角色为SUPER_ADMIN | 访问任何接口 | 全部允许 |
| 12 | 飞书首次登录 | 用户未绑定飞书 | 飞书扫码登录 | 自动注册本地用户，绑定飞书身份 |
| 13 | 飞书重复登录 | 用户已绑定飞书 | 飞书扫码登录 | 直接登录，更新 lastLoginAt |
