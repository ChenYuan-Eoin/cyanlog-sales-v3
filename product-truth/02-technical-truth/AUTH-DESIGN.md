<!--
文件名: AUTH-DESIGN.md
用途: 基于飞书数据结构反推的系统鉴权设计
所属层: 产品真相层 - 技术真相（02-technical-truth）
对应主文档: PROJECT-主文档.md 第3章 认证与权限中心

⚠️ 状态声明：本文件为【备忘暂存】，非正式文档
- 当前阶段：对话式推敲，未经验证，不阻塞主线
- 鉴权设计结果备忘，待后续深化沟通后决定归属和格式
- 暂存位置未定，后续可能合并到认证中心-PRD.md 或技术架构文档
-->

# 系统鉴权设计文档

**文档版本**: 1.0.0
**最后更新**: 2026-05-31
**对应主文档**: PROJECT-主文档.md 第3章
**状态**: 【备忘暂存，待删除】 → 内容已合并到 Account.md，本文件待删除

---

## 1. 设计目标

1. 支持多登录方式（手机号/邮箱/飞书扫码），登录首选项不锁死飞书
2. 组织架构支持从飞书同步，但系统自有部门表（防漂移）
3. 角色权限完全自有，飞书不决定业务权限
4. 为未来接入钉钉/企微预留扩展点

---

## 2. 核心数据模型

### 2.1 自有用户（主表）

```typescript
interface User {
  id: string;                    // 本地 UUID（主键）
  email?: string;
  phone?: string;
  displayName: string;
  avatarUrl?: string;
  status: 'active' | 'inactive' | 'suspended';

  // 本地认证
  passwordHash?: string;         // bcrypt
  emailVerified: boolean;
  phoneVerified: boolean;

  createdAt: Date;
  updatedAt: Date;
}
```

### 2.2 第三方身份映射

```typescript
interface UserIdentity {
  id: string;
  userId: string;                // 关联 User.id

  provider: 'feishu' | 'dingtalk' | 'wecom';
  providerUserId: string;        // 飞书 open_id

  // 飞书特有
  feishuUnionId?: string;
  feishuTenantKey?: string;

  metadata: JSON;                // 第三方原始快照
  syncedAt: Date;
}
```

### 2.3 组织架构

```typescript
interface Department {
  id: string;
  name: string;
  parentId: string | null;
  leaderId: string | null;
  path: string;                  // "总部/销售部/华东区"
  level: number;

  externalId?: string;           // 飞书 department_id
  source: 'feishu' | 'manual'; // 来源追踪
  lastSyncedAt?: Date;
}
```

### 2.4 角色权限

```typescript
interface Role {
  id: string;
  code: 'ADMIN' | 'MANAGER' | 'SALES' | 'REVIEWER' | 'FINANCE';
  name: string;
  permissions: Permission[];
}

interface Permission {
  resource: string;   // 'quote', 'contract', 'config', ...
  action: string;     // 'create', 'read', 'update', 'delete', 'approve'
}
```

---

## 3. 登录流程

### 3.1 流程总览

```
用户访问
  │
  ▼
┌─────────────────────┐
│   选择登录方式      │
└───────┬─────────────┘
        │
   ┌────┼────┬─────────┐
   ▼    ▼    ▼         ▼
 手机   手机  邮箱     飞书
 +密码  +验证码 +验证码  扫码
   │    │    │         │
   │    │    │    ┌────┴────┐
   │    │    │    ▼         ▼
   │    │    │  查找本地?  自动注册
   │    │    │    │         │
   └────┴────┴────┴─────────┘
              │
              ▼
       ┌─────────────┐
       │ 生成自有JWT  │
       │ 登录成功     │
       └─────────────┘
```

### 3.2 第三方登录回调处理

```typescript
// /api/auth/feishu/callback
async function feishuCallback(code: string) {
  // 1. 用 code 换 access_token
  const token = await feishu.getAccessToken(code);

  // 2. 获取飞书用户信息
  const feishuUser = await feishu.getUserInfo(token.access_token);

  // 3. 查找本地用户
  let identity = await UserIdentity.findByProvider('feishu', feishuUser.open_id);
  let user: User;

  if (identity) {
    // 已有绑定，直接登录
    user = await User.findById(identity.userId);
  } else {
    // 首次登录，自动注册
    user = await User.create({
      email: feishuUser.email,
      phone: feishuUser.mobile,
      displayName: feishuUser.name,
      avatarUrl: feishuUser.avatar?.avatar_72x72,
    });

    identity = await UserIdentity.create({
      userId: user.id,
      provider: 'feishu',
      providerUserId: feishuUser.open_id,
      feishuUnionId: feishuUser.union_id,
    });
  }

  // 4. 生成 JWT
  const jwt = generateJWT({ userId: user.id, roles: user.roles });

  return { token: jwt, user };
}
```

---

## 4. 组织同步机制

### 4.1 同步策略

| 同步类型 | 频率 | 范围 |
|---------|------|------|
| 全量同步 | 每日凌晨 | 部门树 + 全部用户 |
| 增量同步 | 飞书事件回调 | 单用户变更 |
| 手动同步 | 管理员触发 | 按需 |

### 4.2 飞书事件回调处理

```
飞书事件 → /api/access/feishu/events
  │
  ▼
验证签名（Encrypt Key）
  │
  ▼
解析事件类型
  │
  ├─ user.created → 创建本地用户 + 身份映射
  ├─ user.updated → 更新本地用户信息
  ├─ user.deleted → 标记用户为 inactive
  ├─ dept.created → 创建部门
  ├─ dept.updated → 更新部门
  └─ dept.deleted → 标记部门为 inactive
```

---

## 5. 数据库 Schema

```sql
-- 自有用户（主表）
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  password_hash VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active',
  email_verified BOOLEAN DEFAULT false,
  phone_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 第三方身份映射
CREATE TABLE user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  feishu_union_id VARCHAR(255),
  feishu_tenant_key VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  UNIQUE(provider, provider_user_id)
);

-- 部门
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  parent_id UUID REFERENCES departments(id),
  leader_id UUID REFERENCES users(id),
  external_id VARCHAR(255),
  source VARCHAR(50) DEFAULT 'manual',
  path TEXT,
  level INT DEFAULT 0,
  sort_order INT DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户-部门关联
CREATE TABLE user_departments (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  PRIMARY KEY (user_id, department_id)
);

-- 角色
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  permissions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户角色
CREATE TABLE user_roles (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
```

---

## 6. 环境变量

```
# 飞书凭证（已配置）
FEISHU_APP_ID=cli_a94fb860e67bdbb3
FEISHU_APP_SECRET=RAEp8f37yww7buulrMJExft84gOzjhBv
FEISHU_ENCRYPT_KEY=O4WRsuHK3kAE4eIKt2dKVbLUoVOJ0rxF
FEISHU_VERIFICATION_TOKEN=BnSYv1iHYBdJNT2Oz5m7neCad1qWH4IQ
FEISHU_REDIRECT_URI=https://quote.cyanlog.icu/api/auth/feishu/callback
```

---

## 7. 关键约束

| 约束项 | 说明 |
|--------|------|
| 飞书 = IdP | 飞书只提供身份认证，不决定业务权限 |
| 本地用户主表 | `users` 是唯一主表，第三方身份只是映射 |
| 角色权限自有 | RBAC 完全本地管理，飞书权限清单不直接映射 |
| 组织同步有副本 | `departments` 有本地副本，定期同步但可独立维护 |
| 预留扩展点 | `provider` 字段枚举可扩展，支持钉钉/企微 |

---

## 8. 待实现清单

- [ ] 创建上述数据库表（Supabase migration）
- [ ] 实现 `/api/auth/feishu/callback` 回调接口
- [ ] 实现 `/api/access/feishu/events` 事件回调
- [ ] 实现组织同步服务（全量 + 增量）
- [ ] 实现 JWT 签发与校验中间件
- [ ] 实现角色权限中间件（RBAC）

---

**文档结束**
