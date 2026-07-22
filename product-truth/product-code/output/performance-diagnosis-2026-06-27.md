# 页面切换与加载性能诊断修复报告

时间：2026-06-27
应用：Price-v3 / product-truth/product-code
本地服务：http://localhost:3001

## 结论

1. “合同 -> 标书 -> 配置中心”等已登录页面切换的主要链路已经可用，热态切换未复现秒级卡顿。前序 Chrome DevTools 交互 trace 记录的页面交互指标为 INP 26ms、CLS 0.00；API smoke 中 `/contracts`、`/tenders`、`/configs` 的已登录切换耗时均低于 0.5s。
2. 当前最明确、可稳定复现的慢点不是 React 页面渲染，而是 Node API 首次访问 Supabase RPC 的传输冷启动。冷登录首个请求 1417ms，其中 `login_rpc_transport` 1224.5ms；同一进程热起来后登录稳定在 257-339ms。
3. `/api/auth/login` 的服务端业务函数本身不是主瓶颈：冷/热请求里 `rpc_total` 约 79-107ms，`rpc_password_verify` 约 73-80ms。慢的部分集中在 Supabase 客户端到远端 RPC 的连接/传输层。
4. 预热端点有效：冷启动后先打 `GET /api/auth/login` 且带 `x-login-prewarm: 1`，预热耗时 664ms；随后真实登录立刻降到 257-274ms。
5. 尝试将登录预热放到 `instrumentation.ts` 的服务启动钩子后，本地 `next start` 下空等不会触发该钩子，首个真实请求仍然冷，且可能与真实登录竞争。因此该试验性代码已回退，没有保留。

## 关键证据

### 页面与构建

- `pnpm exec next build` 成功。
- 关键页面包体：
  - `/contracts`：12.9 kB，First Load JS 144 kB
  - `/tenders`：6.43 kB，First Load JS 126 kB
  - `/configs`：15.4 kB，First Load JS 129 kB
  - `/login`：7.06 kB，First Load JS 110 kB
- 构建仅有 webpack cache 大字符串序列化警告，不是当前页面切换慢的直接证据。

### 登录冷/热路径

无预热、冷启动后的连续登录：

| 请求 | 状态 | 总耗时 | `login_rpc` | `rpc_total` | `login_rpc_transport` |
| --- | --- | ---: | ---: | ---: | ---: |
| login-api-1 | 200 | 1417ms | 1331.4ms | 106.9ms | 1224.5ms |
| login-api-2 | 200 | 339ms | 330.3ms | 94.0ms | 236.3ms |
| login-api-3 | 200 | 310ms | 300.1ms | 93.4ms | 206.7ms |
| login-api-4 | 200 | 275ms | 267.2ms | 79.2ms | 188.0ms |
| login-api-5 | 200 | 286ms | 277.8ms | 80.1ms | 197.7ms |

先预热再登录：

| 请求 | 状态 | 总耗时 | 说明 |
| --- | --- | ---: | --- |
| prewarm-get | 200 | 664ms | `users_query`、`candidate_rpc`、`login_rpc` 均 fulfilled |
| login-after-prewarm-1 | 200 | 274ms | `login_rpc_transport` 181.8ms |
| login-after-prewarm-2 | 200 | 257ms | `login_rpc_transport` 172.7ms |
| login-after-prewarm-3 | 200 | 270ms | `login_rpc_transport` 184.9ms |

## 已执行验证

- `pnpm exec eslint instrumentation.ts lib/login-prewarm.ts app/api/auth/login/route.ts app/api/auth/prewarm/route.ts app/api/auth/login/route.test.ts app/api/auth/prewarm/route.test.ts`
- `pnpm exec vitest run app/api/auth/login/route.test.ts app/api/auth/prewarm/route.test.ts`
  - 2 个测试文件通过
  - 21 个测试通过
- `rm -rf .next && pnpm exec next build`
  - 构建通过
- 本地生产服务已用最终构建启动：
  - `pnpm exec next start -p 3001`

## 修复建议

### P0：保留并依赖请求级预热，不要使用 `instrumentation.ts` 做启动预热

原因：本地 `next start` 证实空闲启动不会触发该钩子；把 Supabase 预热塞到 instrumentation 里不能稳定降低首个真实请求，且可能让首个请求同时承担预热和登录。

### P1：优化登录页预热触发时机

现状：登录页 1200ms 后请求 `GET /api/auth/login` 并带 `x-login-prewarm: 1`。预热一旦先完成，真实登录可降到约 260ms。

建议：
- 保持预热请求和真实登录串行收益，不要让它们并发竞争。
- 可以在用户首次聚焦邮箱/密码输入框时触发预热，且避免提交时强行 abort 已经接近完成的预热。
- 如果要等待预热，必须设置短上限；否则快速登录用户会被预热请求额外阻塞。

### P2：生产环境建议加外部 warmup

如果线上部署为 serverless 或会缩容，首个请求慢仍会周期性出现。建议由外部探活或 cron 定时打：

```bash
curl -sS -H 'x-login-prewarm: 1' https://<host>/api/auth/login >/dev/null
```

频率建议从 3-5 分钟一次开始，按线上函数冷启动周期和 Supabase 连接保活情况调整。

### P3：继续保留服务端 `Server-Timing`

`Server-Timing` 已经能把总耗时拆成 `rpc_total`、`rpc_password_verify`、`login_rpc_transport` 等字段。后续线上如果用户再反馈“框架快、内容慢”，优先抓该请求头即可判断是页面渲染、业务 SQL，还是远端传输冷启动。

## 当前状态

- 没有保留试验性业务代码改动。
- 本地生产服务运行在 `http://localhost:3001`。
- 工作区仍有两处 governance 运行记录文件为 modified；它们不是本次性能代码改动。
