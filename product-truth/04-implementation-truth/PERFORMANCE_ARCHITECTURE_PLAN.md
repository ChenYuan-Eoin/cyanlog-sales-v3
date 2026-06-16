# Price-v3 性能管理体系化方案

## 现状复盘

**问题本质**：不是单一API慢，而是缺乏**端到端性能管理体系**

---

## 一、商业化产品的性能管理标准

### 1. 分层监控体系

| 层级 | 监控工具 | 核心指标 | 告警阈值 |
|------|----------|----------|----------|
| **用户体验层** | Lighthouse CI、Vercel Analytics | LCP < 2.5s, CLS < 0.1, INP < 200ms | LCP > 3s 告警 |
| **应用性能层** | Vercel Speed Insights、Next.js Analytics | TTFB < 200ms, FCP < 1.8s | TTFB > 500ms 告警 |
| **API性能层** | Vercel Logs、自定义Metrics | API P95 < 300ms, 错误率 < 1% | P95 > 1s 告警 |
| **数据库层** | Supabase Dashboard、pg_stat_statements | 查询时间 < 100ms, 连接池使用率 < 80% | 慢查询 > 500ms |

### 2. 技术决策矩阵

**当前架构问题决策**：

| 方案 | LCP预期 | 实施成本 | SEO影响 | 推荐场景 |
|------|---------|----------|---------|----------|
| **A. SPA mode** (禁用SSR) | 1.5s | 低 | 无SEO | 纯后台管理页面 ✅ |
| **B. Edge Cache + ISR** | 1.8s | 中 | 良好 | 内容型页面 |
| **C. Streaming SSR优化** | 2.5s | 高 | 优秀 | 需首屏SEO的页面 |
| **D. 混合架构** (静态shell+客户端hydrate) | 1.5s | 高 | 良好 | 复杂后台系统 ✅ |

**你的场景**：后台管理(configs) → **选A或D**

---

## 二、具体实施方案

### Phase 1: 立竿见影（1天）

**1.1 禁用configs页面的SSR**
```typescript
// app/configs/page.tsx
'use client'

// 添加这行告诉Next.js：这个页面不需要SSR
export const dynamic = 'force-dynamic'
export const revalidate = 0

// 或者使用Next.js 14的Route Segment Config
export const runtime = 'edge' // edge runtime更快
```

预期效果：LCP从7s降到1.5s

**1.2 启用Vercel Edge Cache**
```javascript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=60, stale-while-revalidate=300',
          },
        ],
      },
    ]
  },
}
```

---

### Phase 2：监控体系（2天）

**2.1 接入Vercel Analytics**
```bash
# 安装
npm install @vercel/analytics

# layout.tsx 添加
import { Analytics } from '@vercel/analytics/next'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>{children}</body>
      <Analytics />
    </html>
  )
}
```

**2.2 API性能中间件**
```typescript
// middleware.ts 添加计时
export function middleware(req: NextRequest) {
  const start = Date.now()
  const res = NextResponse.next()
  const duration = Date.now() - start
  
  // 发送到Vercel Analytics或自定义端点
  console.log(`[API] ${req.url} took ${duration}ms`)
  
  return res
}
```

**2.3 Supabase慢查询监控**
```sql
-- 启用pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 查看最慢的10个查询
SELECT 
  query,
  mean_exec_time,
  calls,
  total_exec_time
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;
```

---

### Phase 3：架构优化（1周）

**3.1 数据预取策略**
```typescript
// 使用React Query + 预取
import { dehydrate, QueryClient } from '@tanstack/react-query'

export default async function ConfigsPage() {
  const queryClient = new QueryClient()
  
  // 服务端预取，客户端hydrate
  await queryClient.prefetchQuery({
    queryKey: ['org'],
    queryFn: fetchOrgData,
  })
  
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ConfigsClient />
    </HydrationBoundary>
  )
}
```

**3.2 虚拟滚动（大数据列表）**
```typescript
// 使用@tanstack/react-virtual
import { useVirtual } from '@tanstack/react-virtual'

// 产品列表超过100条时使用虚拟滚动
```

---

## 三、决策点

### 需要你来决策的问题：

1. **configs页面是否要做SEO？**
   - 如果不要 → 立即禁用SSR，LCP直接降到1.5s
   - 如果要 → 需要更复杂的Streaming优化

2. **是否接受第三方监控工具？**
   - Vercel Analytics（免费）：需要我接入
   - Sentry Performance（付费）：更专业

3. **数据库索引执行方式？**
   - 选项A：我提供SQL，你手动在Supabase Dashboard执行
   - 选项B：修复迁移系统，重新push
   - 选项C：重建数据库（测试环境）

---

## 四、数据库索引待执行

以下索引需要执行（已准备但迁移系统受阻）：

```sql
-- 组织管理优化索引
CREATE INDEX IF NOT EXISTS idx_users_org_id_created_at ON users(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_roles_scope ON user_roles(scope_type, scope_id) WHERE scope_type = 'org';
CREATE INDEX IF NOT EXISTS idx_departments_org_depth_sort ON departments(org_id, depth, sort_order);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token, expires_at);

-- 产品/配置优化索引  
CREATE INDEX IF NOT EXISTS idx_products_org_created ON products(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_configs_org_type_key ON configs(org_id, type, key);
```

**执行方式**：登录 https://supabase.com/dashboard/project/wfawwhphfqqwfwrrkogy/sql 
→ 粘贴上述SQL → Run

---

## 五、验证清单

实施后验证：

- [ ] LCP < 2.5s (目前7.01s)
- [ ] TTFB API < 200ms (目前157ms已达标，但Streaming阻塞)
- [ ] 数据库查询P95 < 100ms
- [ ] Lighthouse Performance Score > 70 (目前不及格)

---

**下一步**：
1. 你确认configs页面是否需要SEO
2. 你选择数据库索引执行方式
3. 我立即实施Phase 1
