# 可观测性配置指南

## 1. Sentry 错误监控（必配）

### 1.1 注册 Sentry 账号
1. 访问 https://sentry.io
2. 创建账号并登录
3. 创建新项目：选择 Next.js 类型
4. 复制 DSN（Data Source Name）

### 1.2 配置环境变量
在 Vercel Dashboard → Settings → Environment Variables 添加：

```
NEXT_PUBLIC_SENTRY_DSN=https://xxx@yyy.ingest.sentry.io/zzz
SENTRY_DSN=https://xxx@yyy.ingest.de.sentry.io/zzz  # 服务端
SENTRY_ORG=your-org-name
SENTRY_PROJECT=your-project-name
```

### 1.3 验证配置
部署后在浏览器控制台应看到（如果未配置 DSN）：
```
[Sentry] DSN not configured, error tracking disabled
```

配置成功后，Sentry 会自动捕获：
- 客户端错误（window.onerror）
- 服务端 API 错误
- Edge Runtime 错误
- 性能追踪（采样率 10%）

---

## 2. Vercel Analytics（已自动启用）

项目已安装并启用：
- `@vercel/analytics` - Web Analytics
- `@vercel/speed-insights` - 性能分析

无需额外配置，部署后自动开始收集：
- 页面浏览量
- 访问来源
- 性能指标（FCP, LCP, FID, CLS）
- Core Web Vitals

查看数据：Vercel Dashboard → Analytics

---

## 3. 健康检查端点

系统已内置健康检查 endpoint：

```
GET /api/health         # 基础健康检查
GET /api/health/flight-ready  # 详细系统状态
```

用于：
- 负载均衡器健康检查
- 监控探针
- 部署前验证

---

## 4. 日志记录

API 层统一使用 `logError`：

```typescript
import { logError } from '@/lib/error-log'

await logError({
  source: 'api',
  message: '操作失败',
  error: error,
  context: { user_id: user.id },
})
```

日志存储：Supabase `error_logs` 表
查看方式：直接查询数据库或管理后台

---

## 5. 监控清单

| 指标 | 工具 | 状态 |
|------|------|------|
| 错误追踪 | Sentry | ⏳ 待配置 DSN |
| Web Analytics | Vercel Analytics | ✅ 已启用 |
| 性能分析 | Speed Insights | ✅ 已启用 |
| API 错误日志 | Supabase | ✅ 已启用 |
| 健康检查 | 内置 endpoint | ✅ 已启用 |

---

## 6. 告警建议（P1）

配置 Sentry 告警规则：
1. 错误率 > 1% 时发送邮件
2. 新出现的错误类型通知
3. P0 错误立即通知（电话/短信）

配置 Vercel 告警：
1. 构建失败通知
2. 流量异常波动
