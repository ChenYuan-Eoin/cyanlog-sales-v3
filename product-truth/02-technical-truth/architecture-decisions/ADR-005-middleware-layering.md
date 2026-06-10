# ADR-005: Next.js Middleware分层认证架构

## 状态
已采纳 (2026-05-21)

## 背景 (Context)

销售管理系统需要统一拦截所有请求进行认证和权限检查：

1. **统一拦截需求**：
   - 30+个页面和50+个API路由都需要认证
   - 每个路由都写一遍认证逻辑=维护灾难
   - 必须有一个统一的拦截层

2. **冷启动性能**：
   - 认证是高频操作（每次请求）
   - 不能在认证上消耗过多时间
   - 用户体验要求页面切换流畅

3. **Next.js架构约束**：
   - App Router使用Middleware机制
   - Middleware运行在Edge Runtime（受限环境）
   - 业务API可运行在Node.js Runtime（完整能力）

4. **多入口架构**：
   - 销售系统有多个子域名（quote/contract/...）
   - 每个入口有特定的默认路径
   - 需要基于Host的智能重定向

## 决策 (Decision)

采用**Middleware统一拦截 + 路径白/黑名单 + 顺序校验**架构：

```
┌─────────────────────────────────────────────────────┐
│  middleware.ts 执行顺序                              │
│                                                       │
│  1. Host重定向 (多入口)                                │
│     quote.cyanlog.icu → /quotes                       │
│     contract.cyanlog.icu → /contracts                 │
│                                                       │
│  2. 公开路径放行                                       │
│     /, /login, /register, /api/auth/login, ...        │
│                                                       │
│  3. Token提取（header或cookie）                        │
│                                                       │
│  4. 串行认证（必须）                                    │
│     a) auth_tokens表：token有效性 + 过期检查            │
│     b) users表：用户存在性 + must_change_password      │
│                                                       │
│  5. 并行权限加载（依赖user_id，但roles查询独立）          │
│     user_roles → roles(code, permissions)              │
│                                                       │
│  6. 路径级权限校验                                     │
│     /admin → 'admin:access'                          │
│     /configs → 'config:*'                            │
│                                                       │
│  7. 透传user context到下游                             │
│     x-user-id, x-user-roles, x-user-permissions      │
└─────────────────────────────────────────────────────┘
```

### 路径配置
```typescript
const PUBLIC_PATHS = ['/', '/login', '/register']
const PUBLIC_API_PATHS = [
  '/api/auth/login',
  '/api/health',
  '/api/cron',  // Vercel Cron调用
]
const PASSWORD_CHANGE_ALLOWED_PATHS = [
  '/change-password',
  '/api/auth/me',
  '/api/auth/change-password',
]
```

### Host重定向
```typescript
const HOST_REDIRECTS = {
  'quote.cyanlog.icu': '/quotes',
  'contract.cyanlog.icu': '/contracts',
}
```

## 影响 (Consequences)

### 正面影响
- ✅ **统一拦截**：所有路由自动受保护
- ✅ **多入口支持**：基于Host的智能路由
- ✅ **分层校验**：早期拒绝减少不必要DB查询
- ✅ **零代码侵入**：业务路由无需写认证代码

### 负面影响
- ⚠️ **Edge Runtime限制**：无fs/crypto部分方法
- ⚠️ **3次DB查询**：每个请求固定开销
- ⚠️ **首次加载慢**：冷启动需建立DB连接

## 备选方案 (Alternatives Considered)

### 备选A：API Route内手动校验
- 实现简单，无中间件概念
- 但**50+路由都需重复代码**
- 容易遗漏新加的路由
- **否决原因**：维护成本不可持续

### 备选B：自定义Next.js Server（Express/Koa）
- 完全控制
- 但**失去Vercel Edge Functions优势**
- 部署复杂
- 冷启动慢
- **否决原因**：放弃Next.js核心价值

### 备选C：API Gateway外部拦截（如Kong/Envoy）
- 企业级方案
- 但**增加基础设施**
- 团队需要维护网关
- **否决原因**：当前规模不需要

### 备选D：客户端路由守卫 + SSR判定
- 看似无服务端开销
- 但**安全漏洞**：绕过客户端=绕过认证
- 不可接受
- **否决原因**：安全要求

## 实施细节 (Implementation)

### 关键优化
1. **并行DB查询**：
```typescript
// 步骤1：必须先查auth_tokens获取user_id
const { data: tokenRecord } = await supabase...

// 步骤2：users和user_roles可并行
const [{ data: userRow }, { data: userRolesData }] = await Promise.all([
  supabase.from('users')...,
  supabase.from('user_roles')...
])
```

2. **失败快速返回**：
```typescript
if (!tokenRecord) {
  // API路由返回401，页面路由重定向到/login
  return pathname.startsWith('/api/') 
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : NextResponse.redirect(buildRedirectUrl(request, '/login'))
}
```

3. **状态透传**：
```typescript
// 把认证结果作为request header透传，避免下游重复查询
requestHeaders.set('x-user-id', userId)
requestHeaders.set('x-user-roles', roleCodes.join(','))
requestHeaders.set('x-user-permissions', allPermissions.join(','))
```

### 性能基准
| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 公开路径 | 1ms | <1ms |
| 静态资源 | 1ms | <1ms |
| API已登录 | ~60ms (3次串行) | ~30ms (1+2次: 1串行+2并行) |
| 页面已登录 | ~60ms | ~30ms |

## 验证标准 (Validation)

| 指标 | 目标值 |
|------|--------|
| Middleware P99延迟 | <50ms |
| 公开路径访问 | 0 DB查询 |
| 权限拦截准确率 | 100% |
| 冷启动时间 | <1s |

## 参考 (References)

- 代码实现：`middleware.ts`
- 权限逻辑：`lib/permissions.ts`
- 数据范围：`lib/scoped-access.ts`
- Next.js文档：https://nextjs.org/docs/app/building-your-application/routing/middleware
