# 特性测试：旧路由暗桩分析

## 分析对象
`/api/admin/org/route.ts` (1009行) - POST/PATCH type 分发路由

## 暗桩总览（按业务分类）

### 🔴 高危暗桩 1：用户创建 POST type='user'

**表面行为**：创建用户 → 返回 userId + tempPassword

**实际副作用链（至少影响4张表）**：
```
POST /api/admin/org {type: 'user'}
  ├─> [Table: users] INSERT 新用户记录
  │     └─ 生成 bcrypt hash 的临时密码
  │
  ├─> [Table: user_organizations] UPSERT 用户-组织关联 (is_default=true)
  │
  ├─> [Table: user_departments] UPDATE/UPSERT
  │     └─ syncPrimaryDepartmentMembership()
  │         ├─ UPDATE: 将该用户的所有 department.is_primary = false
  │         └─ UPSERT: (user_id, primary_dept_id, is_primary=true)
  │
  ├─> [Table: sales_space_members] INSERT（条件性）
  │     └─ syncUserSalesSpaces()
  │         ├─ 追溯主部门的父部门链（最多12层）
  │         ├─ 查找这些部门关联的销售空间
  │         ├─ 检查该用户是否已属于这些空间
  │         └─ INSERT 缺失的 (space_id, user_id, 'MEMBER')
  │
  └─> [Table: user_roles] INSERT（条件性）
        └─ replaceOrgRoles()
           ├─ DELETE: 该用户的 org scope 角色
           └─ INSERT: 新的角色分配
```

**⚠️ 风险**：拆分到新路由 `/api/admin/users` 时，
如果忘记调用 `syncPrimaryDepartmentMembership()` 或 `syncUserSalesSpaces()`，
会导致用户主部门/销售空间不一致。

---

### 🔴 高危暗桩 2：用户更新（upsert=true）

**表面行为**：更新用户信息 → 返回 updated

**实际副作用**（与创建相同但不包括密码重置）：
```
POST /api/admin/org {type: 'user', upsert: true}
  ├─> [Table: users] UPDATE display_name, title, primary_dept_id, status
  ├─> [Table: user_departments] UPDATE/UPSERT (同暗桩1)
  ├─> [Table: sales_space_members] INSERT (同暗桩1)
  └─> [Table: user_roles] INSERT (条件性, 同暗桩1)
```

**⚠️ 风险**：upsert 路径很容易被忽略，
因为 POST 既处理创建又处理更新。

---

### 🟡 中危暗桩 3：部门创建 POST type='department'

**表面行为**：创建部门 → 返回 departmentId

**隐藏逻辑**：
```
POST /api/admin/org {type: 'department'}
  ├─> [Table: departments] INSERT
  │     ├─ id: randomUUID()
  │     ├─ org_id: auth.orgId
  │     ├─ name: 自动trim
  │     ├─ code: 自动trim
  │     ├─ parent_id: 校验后设置
  │     └─ source: 'manual'  ← 硬编码！
```

**⚠️ 风险**：`source: 'manual'` 是写死的，
如果未来需要支持 'feishu' 等其他来源，这个硬编码会出问题。

---

### 🟡 中危暗桩 4：部门更新 PATCH type='department'

**表面行为**：更新部门 → 返回 ok

**隐藏逻辑**：
```
PATCH /api/admin/org {type: 'department'}
  ├─> [Table: departments] UPDATE name, parent_id
  └─> 无级联更新（部门改名不会自动更新用户表中的部门名称）
```

**⚠️ 风险**：部门改名后，`users.primary_dept_id` 仍然指向旧部门 ID，
但部门名称已变。这可能导致前端显示不一致。
（注：目前通过 `departmentNameById` 在查询时映射解决）

---

### 🔴 高危暗桩 5：角色分配 PATCH type='user_roles'

**表面行为**：分配角色 → 返回 ok

**实际副作用**：
```
PATCH /api/admin/org {type: 'user_roles'}
  ├─> [Table: user_roles] DELETE (该用户 org scope 的所有角色)
  └─> [Table: user_roles] INSERT (新的角色分配)
```

**⚠️ 风险**：
- 这是"全量替换"而非"增量更新"
- 如果新路由改为 PUT `/api/admin/users/:id/roles`，
  必须保持"全量替换"语义
- 否则可能遗留旧角色

---

### 🔴 高危暗桩 6：作用域角色分配 PATCH type='user_scoped_roles'

**表面行为**：分配带作用域的角色 → 返回 ok

**实际副作用**：
```
PATCH /api/admin/org {type: 'user_scoped_roles'}
  ├─> [Table: user_roles] DELETE (该用户的所有角色，包括 org/department/space)
  │     └─ clearUserRolesForOrg()：
  │         ├─ DELETE org scope 角色
  │         ├─ DELETE department scope 角色（该组织下的所有部门）
  │         └─ DELETE space scope 角色（该组织下的所有空间）
  │
  └─> [Table: user_roles] INSERT (新的作用域角色分配)
        └─ replaceScopedRoles()
           ├─ DELETE: 先删该 scope_type 的角色
           └─ INSERT: 新的角色分配
```

**⚠️ 风险**：
- `clearUserRolesForOrg` 会先**清空**该用户的所有角色（包括 department 和 space）
- 然后重新插入新的作用域角色分配
- 如果新路由忘记调用 `clearUserRolesForOrg`，
  会导致旧角色残留

---

### 🟡 中危暗桩 7：密码重置 PATCH type='user_password_reset'

**表面行为**：重置密码 → 返回临时密码

**实际副作用**：
```
PATCH /api/admin/org {type: 'user_password_reset'}
  ├─> [Table: users] UPDATE
  │     ├─ password_hash: bcrypt hash
  │     └─ must_change_password: true
```

**⚠️ 风险**：
- `must_change_password` 是强制性的，如果新路由忘记设置，
  用户不会被提示修改密码
- 临时密码通过明文返回（安全考虑）

---

## 暗桩汇总表

| # | 业务 | 表面操作 | 实际影响表数 | 关键副作用 | 风险等级 |
|---|------|----------|-------------|-----------|---------|
| 1 | 创建用户 | INSERT users | 4张 | 密码hash、user_orgs、user_depts、space_members、roles | 🔴 高 |
| 2 | 更新用户 | UPDATE users | 3张 | 同上（不含密码） | 🔴 高 |
| 3 | 创建部门 | INSERT depts | 1张 | source='manual' 硬编码 | 🟡 中 |
| 4 | 更新部门 | UPDATE depts | 1张 | 无级联 | 🟡 中 |
| 5 | 分配角色 | DELETE+INSERT roles | 1张 | 全量替换语义 | 🔴 高 |
| 6 | 分配作用域角色 | DELETE+INSERT roles | 1张 | clearUserRolesForOrg 会清掉所有角色 | 🔴 高 |
| 7 | 重置密码 | UPDATE users | 1张 | must_change_password=true 强制 | 🟡 中 |

---

## 双轨验证策略

### 核心原则
**"新路由的行为必须与旧路由完全一致，包括所有副作用"**

### 验证方法
1. **请求级别**：新旧路由对同一请求的响应是否一致
2. **数据库级别**：执行后数据库状态是否一致
3. **边界级别**：脏数据、异常输入的处理是否一致

### 具体实现（以部门创建为例）

```typescript
// 特性测试：录制旧路由行为
const baseline = await recordOldRoute({
  method: 'POST',
  url: '/api/admin/org',
  body: { type: 'department', name: '研发部', parentId: null }
})

// 特性测试：新路由必须与旧路由一致
const newResult = await callNewRoute({
  method: 'POST',
  url: '/api/admin/departments',
  body: { name: '研发部', parentId: null }
})

// 断言1：HTTP状态码一致
expect(newResult.status).toBe(baseline.status)

// 断言2：响应数据结构一致
expect(newResult.body).toMatchContract(DepartmentSchema)

// 断言3：数据库变更一致（关键！）
expect(getDepartmentByName('研发部')).toEqual(baseline.dbSnapshot.departments[0])
```

---

## 重构优先级

按风险从高到低排序：
1. **部门管理** (POST type='department') - 最简单，只有1张表，先拆
2. **密码管理** (PATCH type='user_password_reset') - 独立业务，只有1张表
3. **用户管理** (POST type='user') - 最复杂，有4张表，需要最后拆
4. **角色分配** (PATCH type='user_roles') - 涉及全量替换语义
5. **作用域角色** (PATCH type='user_scoped_roles') - 最危险，clearUserRolesForOrg
