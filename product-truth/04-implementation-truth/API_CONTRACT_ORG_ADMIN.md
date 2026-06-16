# API 契约定义 - 组织架构管理 (Org Admin)

## 概述

**版本**: v1.0
**日期**: 2026-06-15
**状态**: 草案 → 重构中

**重构目标**：将 `/api/admin/org` 单一路由拆分为 5 个独立 API，每个 API 对应一个业务领域。

---

## 1. 部门管理 API (`/api/admin/departments`)

### 1.1 GET /api/admin/departments
**描述**: 获取组织部门列表

**请求头**:
```http
Authorization: Bearer <token>
```

**响应** (200 OK):
```json
{
  "data": {
    "departments": [
      {
        "id": "uuid",
        "name": "string",
        "code": "string | null",
        "depth": "number",
        "member_count": "number",
        "parent_id": "string | null",
        "parent_name": "string | null"
      }
    ]
  }
}
```

### 1.2 POST /api/admin/departments
**描述**: 创建部门

**请求体**:
```json
{
  "name": "string (required, min=1, max=255)",
  "code": "string | null (optional)",
  "parentId": "string | null (optional, must exist in org)"
}
```

**响应** (201 Created):
```json
{
  "ok": true,
  "departmentId": "uuid"
}
```

**错误**:
- 400: INVALID_DEPARTMENT_PAYLOAD - 名称不能为空
- 400: INVALID_PARENT_DEPARTMENT - 上级部门不存在
- 403: FORBIDDEN - 无管理权限

### 1.3 PATCH /api/admin/departments/:id
**描述**: 更新部门

**请求体**:
```json
{
  "name": "string (optional)",
  "parentId": "string | null (optional)"
}
```

**约束**:
- parentId !== id (不能挂到自己下面)
- 新parentId不能是当前部门的子孙节点 (防止循环)

**错误**:
- 400: DEPARTMENT_PARENT_CYCLE - 循环依赖
- 404: DEPARTMENT_NOT_FOUND

---

## 2. 用户管理 API (`/api/admin/users`)

### 2.1 GET /api/admin/users
**描述**: 获取组织成员列表

**查询参数**:
- `deptId`: string | null (可选，按部门筛选)
- `status`: 'active' | 'inactive' | 'suspended' (可选)
- `search`: string (可选，按姓名/邮箱模糊搜索)
- `limit`: number (默认50, 最大200)
- `offset`: number (默认0)

**响应** (200 OK):
```json
{
  "data": {
    "users": [
      {
        "id": "uuid",
        "email": "string",
        "display_name": "string",
        "title": "string | null",
        "primary_dept_id": "string | null",
        "primary_dept_name": "string",
        "role_names": "string",
        "role_codes": ["string"],
        "scoped_roles": [
          {
            "roleId": "string",
            "roleName": "string",
            "roleCode": "string",
            "scopeType": "org | department | space",
            "scopeId": "string | null",
            "scopeName": "string",
            "grantedAt": "string | null"
          }
        ],
        "status": "active | inactive | suspended",
        "must_change_password": "boolean"
      }
    ]
  },
  "pagination": {
    "total": "number",
    "limit": "number",
    "offset": "number",
    "hasMore": "boolean"
  }
}
```

### 2.2 POST /api/admin/users
**描述**: 创建新成员

**请求体**:
```json
{
  "email": "string (required, email format)",
  "displayName": "string (required, min=1, max=255)",
  "title": "string | null (optional)",
  "primaryDeptId": "string | null (optional, must exist)",
  "roleCodes": ["string"] (optional),
  "status": "active | inactive | suspended (default: active)"
}
```

**响应** (201 Created):
```json
{
  "ok": true,
  "userId": "uuid",
  "created": true,
  "tempPassword": "string (auto-generated)"
}
```

**错误**:
- 400: INVALID_USER_PAYLOAD - 邮箱/姓名不能为空
- 400: INVALID_PRIMARY_DEPARTMENT - 主部门不存在
- 409: USER_EXISTS - 邮箱已存在

### 2.3 PATCH /api/admin/users/:id
**描述**: 更新成员信息

**请求体**:
```json
{
  "title": "string | null (optional)",
  "primaryDeptId": "string | null (optional)",
  "status": "active | inactive | suspended (optional)"
}
```

**错误**:
- 404: USER_NOT_FOUND

---

## 3. 角色权限管理 API (`/api/admin/roles`)

### 3.1 GET /api/admin/roles
**描述**: 获取组织角色列表（含权限和成员）

**响应** (200 OK):
```json
{
  "data": {
    "roles": [
      {
        "id": "uuid",
        "code": "string",
        "name": "string",
        "description": "string | null",
        "permissions": ["string"],
        "sort_order": "number | null",
        "memberCount": "number"
      }
    ]
  }
}
```

### 3.2 PUT /api/admin/users/:id/roles
**描述**: 为用户分配组织级角色

**请求体**:
```json
{
  "roleCodes": ["string"] (required)
}
```

**响应** (200 OK):
```json
{
  "ok": true
}
```

**错误**:
- 404: USER_NOT_FOUND
- 400: INVALID_ROLE_PAYLOAD

### 3.3 PUT /api/admin/users/:id/scoped-roles
**描述**: 为用户分配带作用域的角色

**请求体**:
```json
{
  "assignments": [
    {
      "scopeType": "org | department | space",
      "scopeId": "string | null",
      "roleCodes": ["string"]
    }
  ]
}
```

**错误**:
- 400: INVALID_SCOPE_DEPARTMENT - 部门不存在
- 400: INVALID_SCOPE_SPACE - 销售空间不存在

---

## 4. 密码管理 API (`/api/admin/users/:id/password`)

### 4.1 POST /api/admin/users/:id/password/reset
**描述**: 重置用户密码

**请求体**: `{}` (空对象，操作确认)

**响应** (200 OK):
```json
{
  "ok": true,
  "tempPassword": "string (auto-generated)"
}
```

**约束**:
- 仅 ORG_ADMIN / SUPER_ADMIN 可执行
- 重置后用户必须修改密码（must_change_password = true）

**错误**:
- 404: USER_NOT_FOUND
- 500: PASSWORD_RESET_FAILED

---

## 5. 销售空间管理 API (`/api/admin/sales-spaces`)

### 5.1 GET /api/admin/sales-spaces
**描述**: 获取组织销售空间列表

**响应** (200 OK):
```json
{
  "data": {
    "spaces": [
      {
        "id": "uuid",
        "name": "string",
        "description": "string | null",
        "department_id": "string",
        "department_name": "string",
        "owner_id": "string | null"
      }
    ]
  }
}
```

### 5.2 POST /api/admin/sales-spaces
**描述**: 创建销售空间

**请求体**:
```json
{
  "name": "string (required)",
  "description": "string | null (optional)",
  "departmentId": "string (required, must exist)"
}
```

**响应** (201 Created):
```json
{
  "ok": true,
  "spaceId": "uuid"
}
```

---

## 认证与权限

所有 API 统一要求：

**请求头**:
```http
Authorization: Bearer <token>
```

**权限要求**:
- `org:write` 或 `admin:access` 权限
- 具体：canManageOrg(assignments) === true

**统一错误响应**:
```json
{
  "error": "string",
  "code": "string",
  "status": "number"
}
```

**错误码**:
- 401: UNAUTHORIZED - 未登录或登录已过期
- 403: FORBIDDEN - 无权限访问组织管理
- 500: INTERNAL_ERROR - 服务器内部错误

---

## 重构后架构图

```
/api/admin/
  ├── /departments          ← 原 POST/PATCH type=department
  │    ├── GET  (列表)
  │    ├── POST (创建)
  │    └── PATCH/:id (更新)
  ├── /users                ← 原 POST type=user, PATCH type=user
  │    ├── GET  (列表)
  │    ├── POST (创建)
  │    ├── PATCH/:id (更新)
  │    ├── /:id/roles       ← 原 PATCH type=user_roles
  │    │    └── PUT (分配角色)
  │    ├── /:id/scoped-roles ← 原 PATCH type=user_scoped_roles
  │    │    └── PUT (分配作用域角色)
  │    └── /:id/password    ← 原 PATCH type=user_password_reset
  │         └── POST /reset (重置密码)
  └── /sales-spaces         ← 间接关联，原 syncUserSalesSpaces
       ├── GET  (列表)
       └── POST (创建)
```

---

## TypeScript 接口定义

```typescript
// === 部门管理 ===
interface Department {
  id: string
  name: string
  code: string | null
  depth: number
  member_count: number
  parent_id: string | null
  parent_name: string | null
}

interface CreateDepartmentRequest {
  name: string
  code?: string | null
  parentId?: string | null
}

interface CreateDepartmentResponse {
  ok: boolean
  departmentId: string
}

// === 用户管理 ===
interface OrgUser {
  id: string
  email: string
  display_name: string
  title: string | null
  primary_dept_id: string | null
  primary_dept_name: string
  role_names: string
  role_codes: string[]
  scoped_roles: ScopedRoleAssignment[]
  status: 'active' | 'inactive' | 'suspended'
  must_change_password: boolean
}

interface CreateUserRequest {
  email: string
  displayName: string
  title?: string | null
  primaryDeptId?: string | null
  roleCodes?: string[]
  status?: 'active' | 'inactive' | 'suspended'
}

interface CreateUserResponse {
  ok: boolean
  userId: string
  created: boolean
  tempPassword: string
}

// === 角色权限 ===
interface Role {
  id: string
  code: string
  name: string
  description: string | null
  permissions: string[] | null
  sort_order: number | null
  memberCount: number
}

interface AssignRolesRequest {
  roleCodes: string[]
}

interface AssignScopedRolesRequest {
  assignments: Array<{
    scopeType: 'org' | 'department' | 'space'
    scopeId: string | null
    roleCodes: string[]
  }>
}

// === 密码管理 ===
interface ResetPasswordResponse {
  ok: boolean
  tempPassword: string
}

// === 销售空间 ===
interface SalesSpace {
  id: string
  name: string
  description: string | null
  department_id: string
  department_name: string
  owner_id: string | null
}

interface CreateSalesSpaceRequest {
  name: string
  description?: string | null
  departmentId: string
}
```

---

## 迁移计划

### Phase 1: 契约锚定（第1天）
- [ ] 确认本契约文档
- [ ] 创建共享 TypeScript 类型文件
- [ ] 编写集成测试（基于契约，先测后拆）

### Phase 2: 手术式拆除（第2-5天）
- [ ] 创建 `/api/admin/departments` 路由
- [ ] 创建 `/api/admin/users` 路由
- [ ] 创建 `/api/admin/users/:id/roles` 路由
- [ ] 创建 `/api/admin/users/:id/password` 路由
- [ ] 创建 `/api/admin/sales-spaces` 路由
- [ ] 每个新路由保持原有数据库交互逻辑不变

### Phase 3: 前端适配（第6-10天）
- [ ] 更新前端 fetch 调用地址
- [ ] 实现按需加载（Tab 切换时才请求对应 API）
- [ ] 移除旧路由 `/api/admin/org` 的兼容代码

---

**文档维护**：本契约文档应随 API 变更同步更新，作为前后端协作的"唯一真相源"。
