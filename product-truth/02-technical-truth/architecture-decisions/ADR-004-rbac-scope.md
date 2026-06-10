# ADR-004: RBAC权限模型与数据范围隔离

## 状态
已采纳 (2026-05-21)

## 背景 (Context)

销售管理系统涉及多角色协作，权限需求：

1. **多角色协同**：
   - 销售：创建报价、查看自己的合同
   - 销售经理：审批折扣、查看团队数据
   - 法务：审核所有合同、配置规则
   - 超级管理员：管理组织、用户、角色
   - 销售运营：用户管理、配置管理

2. **数据隔离**：
   - 销售A看不到销售B的私有报价
   - 经理能看到团队成员的报价
   - 跨团队/跨组织数据严格隔离
   - 多组织（org）层级：销售可能属于多个组织（如母子公司）

3. **权限变更灵活性**：
   - 角色权限应可配置（不写死代码）
   - 新增角色应无需改代码
   - 权限可按组织/部门/销售空间维度细分

4. **审计需求**：
   - 每个操作需要记录"谁、有哪些权限、做了什么"
   - 权限继承关系需要可追溯
   - 监管要求"最小权限原则"

## 决策 (Decision)

采用**RBAC + 数据范围(ScoPE) 二维权限模型**：

```
┌─────────────────────────────────────────────────┐
│  权限判定 = 角色权限(what) × 数据范围(where)     │
│                                                   │
│  What: 角色 → 权限列表                            │
│    user → roles(permissions) → ['quote:create',  │
│                                  'contract:read'] │
│                                                   │
│  Where: 用户 → 可访问的数据范围                    │
│    user → org_id, department_ids, space_ids       │
└─────────────────────────────────────────────────┘
```

### 数据库Schema
```sql
-- 角色与权限
CREATE TABLE roles (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL,        -- 'SALES', 'SALES_MANAGER', 'LEGAL', 'SUPER_ADMIN'
  name TEXT NOT NULL,
  permissions JSONB NOT NULL -- ["quote:*", "contract:read"]
);

-- 用户与角色的关系（带scope）
CREATE TABLE user_roles (
  user_id UUID,
  role_id UUID,
  scope_type TEXT,           -- 'org' | 'department' | 'space'
  scope_id UUID,             -- 对应范围ID
  granted_at TIMESTAMPTZ
);

-- 用户组织
CREATE TABLE user_organizations (
  user_id UUID,
  org_id UUID,
  is_default BOOLEAN
);
```

### 权限粒度
| 权限符号 | 含义 | 示例 |
|---------|------|------|
| `*` | 全部权限 | SUPER_ADMIN |
| `resource:*` | 资源全部操作 | `quote:*` (报价增删改查) |
| `resource:action` | 资源特定操作 | `quote:create` (仅创建) |

### 数据范围（Scope）
| Scope类型 | 含义 | 查询注入条件 |
|----------|------|-------------|
| org | 组织级 | `WHERE org_id IN (user.org_ids)` |
| department | 部门级 | `WHERE department_id IN (user.dept_ids)` |
| space | 销售空间 | `WHERE space_id IN (user.space_ids)` |

### 路径级权限
```typescript
const ROUTE_PERMISSIONS: Record<string, string> = {
  '/configs': 'config:*',
  '/admin': 'admin:access',
}
```

## 影响 (Consequences)

### 正面影响
- ✅ **可配置**：新增角色/权限无需改代码
- ✅ **多维隔离**：org+dept+space三层数据范围
- ✅ **可审计**：权限继承关系可追溯
- ✅ **最小权限**：基于角色而非全开

### 负面影响
- ⚠️ **JOIN开销**：每请求3-4次权限相关查询
- ⚠️ **权限爆炸**：细粒度权限可能导致管理复杂
- ⚠️ **缓存挑战**：权限变更需及时生效

## 备选方案 (Alternatives Considered)

### 备选A：硬编码角色
- 实现简单
- 但**新增角色需要改代码+重新部署**
- 不支持多租户定制
- **否决原因**：无法满足"自主可控+可配置"要求

### 备选B：ABAC（属性权限）
- 极其灵活（基于属性表达式）
- 但**性能差**（每次请求需解析表达式）
- 难以审计和调试
- 工具链不成熟
- **否决原因**：当前业务RBAC足够，ABAC过度设计

### 备选C：Casbin/Ory Keto等策略引擎
- 开箱即用
- 但增加外部依赖
- 策略文件管理复杂
- **否决原因**：当前场景不需要规则表达式，直接SQL+JSONB足够

### 备选D：完全无权限（信任内部用户）
- 0开销
- 但**任何越权都无防护**
- 监管合规失败
- **否决原因**：基础安全要求不可放弃

## 实施细节 (Implementation)

### 权限校验
```typescript
// 路径级校验
const required = getRequiredPermission(pathname)
const allowed = required === 'admin:access'
  ? canAccessOrgAdmin(allPermissions, roleCodes)
  : hasPermission(allPermissions, required)
```

### 数据范围注入
```typescript
// lib/scoped-access.ts
const { userIds: accessibleUserIds } = await listAccessibleUserIds(userId, orgId)
// 所有查询都基于accessibleUserIds过滤
```

### 超级管理员绕过
```typescript
if (roleCodes.includes('SUPER_ADMIN')) {
  allPermissions.push('*')
  // SUPER_ADMIN可访问所有数据，无需scope限制
}
```

## 验证标准 (Validation)

| 指标 | 目标值 |
|------|--------|
| 权限查询延迟 | <30ms (P95) |
| 权限误判率 | 0%（不出现越权或不足权） |
| 权限变更生效时间 | <1s |
| RBAC测试覆盖率 | >90% |

## 参考 (References)

- 母文档 Account.md - 认证与权限模块
- 代码实现：`middleware.ts`
- 权限逻辑：`lib/permissions.ts`
- 数据范围：`lib/scoped-access.ts`
- 测试：`lib/auth.test.ts`
