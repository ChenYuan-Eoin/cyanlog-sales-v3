# E2E 测试（Playwright）

3 条核心路径的端到端验证。

## 首次运行

```bash
# 1. 安装浏览器（一次性，约 300MB）
pnpm test:e2e:install

# 2. 跑测试
pnpm test:e2e
```

## 覆盖路径

| 路径 | 测试 | 关键验证 |
|------|------|----------|
| 登录 | `路径 1：登录流程` | 错误凭证 → 错误提示；正确凭证 → 跳转首页 |
| 配置中心 | `路径 2：配置中心新建规则` | 新建 → 出现在列表 |
| 报价中心 | `路径 3：报价中心新建报价` | 新建 → 单号生成 QT-YYYYMMDD-XXXX |
| 健康检查 | `GET /api/health` | 200 + status=ok |

## 前置条件

- 测试环境已有种子数据
- 测试用户凭证写在 `e2e/critical-path.spec.ts`:
  ```ts
  email: 'test-admin@cyanlog.icu'
  password: 'TestPassword123!'
  ```
- 默认 baseURL 是 `http://localhost:3000`，可设 `BASE_URL` 覆盖

## 运行模式

```bash
# 默认（headless，自动启动 dev server）
pnpm test:e2e

# 看到浏览器
pnpm test:e2e:headed

# 指向已运行的服务器
BASE_URL=http://localhost:3000 pnpm test:e2e
```

## 限制

- 串行运行（workers=1），避免共享数据库状态冲突
- 仅 Chromium（不覆盖 Safari/Firefox，避免维护成本）
- 不重置数据库（依赖种子数据一致）
- 真实 E2E 测试在线上数据库上跑有风险——CI 中可标注 optional
