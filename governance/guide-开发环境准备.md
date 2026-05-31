# Cyanlog Sales Platform V3 - 开发环境准备指南

**适用版本**: MVP v1.0  
**准备时间**: 约2-3小时  
**目标**: 本地可运行，能打开当前工作台基础页，并知道代码、治理、文档分别在哪

---

## 1. 前置依赖

### 必须安装

| 软件 | 版本要求 | 安装命令/下载 |
|-----|---------|--------------|
| Node.js | >= 18.17 | `brew install node` 或官网下载 |
| pnpm | >= 8.0 | `npm install -g pnpm` |
| 容器运行时 | 能执行 `docker compose` | Docker Desktop，或 `colima + docker`，或 Podman Desktop，或 Rancher Desktop |
| Git | 任意版本 | `brew install git` |

### 可选但推荐

| 软件 | 用途 |
|-----|------|
| VS Code | 主IDE |
| TablePlus | 数据库可视化 |
| 任意 OpenAI 兼容本地模型工具 | 本地推理接口（可选） |

补充说明：
- 当前本地基础设施只要求能运行 `docker compose`，不强绑定 Docker Desktop。
- Kubernetes 不是当前仓库的默认本地开发入口。

---

## 2. 工作区结构

当前工作区不是单一仓结构，先认清边界：

- `/Users/nsss/Price-v3`
  - 文档、治理、辅助脚本的工作区根
- `/Users/nsss/Price-v3/cyanlog-sales-v3`
  - 当前实际运行的 Next.js 应用
  - 当前唯一业务代码 Git 仓

治理脚本和文档都在外层，实际前端开发在 `cyanlog-sales-v3` 内进行。

额外提醒：
- 根目录 `/Users/nsss/Price-v3/setup.sh` 是历史脚手架脚本，用于早期重新生成示例工程。
- 当前默认开发入口不是它，而是 `cyanlog-sales-v3` 里的现有业务仓。

---

## 3. 项目初始化

### 3.1 安装依赖

```bash
cd /Users/nsss/Price-v3/cyanlog-sales-v3
pnpm install
```

### 3.2 启动开发服务器

```bash
cd /Users/nsss/Price-v3/cyanlog-sales-v3
pnpm dev
```

### 3.3 运行静态检查

```bash
cd /Users/nsss/Price-v3/cyanlog-sales-v3
pnpm lint
pnpm build
```

如果你要单独跑 TypeScript 检查，先启动一次 `pnpm dev` 或执行一次 `pnpm build`，让 Next 生成 `.next/types`。

---

## 4. Supabase 配置

当前首页骨架不依赖 Supabase 才能启动；只有在接入真实数据流时才需要补齐。

### 4.1 环境变量来源

优先使用云端 Supabase 项目，将值写入 `cyanlog-sales-v3/.env.local`。

### 4.2 本地服务说明

仓库根目录提供一个可用的本地基础设施编排：`/Users/nsss/Price-v3/docker-compose.yml`。

运行前提：本机需要一套能执行 `docker compose` 的容器运行时。当前暂定按 Docker CLI 入口执行；若后续需要替代运行时，可切到兼容 `docker compose` 的方案。

```bash
# 在仓库根目录启动（推荐）
cd /Users/nsss/Price-v3
docker compose up -d

# 或者在应用目录启动
cd /Users/nsss/Price-v3/cyanlog-sales-v3
docker compose -f ../docker-compose.yml up -d
```

当前 compose 提供：
- Postgres: `localhost:54322`（容器内: `db:5432`）
- Supabase Auth（GoTrue，经 Kong 代理）: `http://localhost:54321/auth/v1/*`
- MinIO: `http://localhost:9000`（Console: `http://localhost:9001`）
- Redis: `localhost:6379`

说明：该 compose 目前只覆盖「Auth + DB」这一条最小链路，并不等价于完整的 Supabase 本地栈（未包含 PostgREST/Storage/Realtime 等）。

---

## 5. 本地模型配置

当前工程只依赖一个 OpenAI 兼容的本地接口地址，不绑定具体桌面工具。

### 5.1 验证本地模型接口

```bash
curl http://localhost:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local-model",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

如果你暂时不接 AI 功能，当前首页骨架也可以独立开发。

---

## 6. 环境变量配置

### 6.1 创建 `.env.local`

```bash
cd /Users/nsss/Price-v3/cyanlog-sales-v3
cp .env.example .env.local
```

### 6.2 当前模板关键字段

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=change-this-to-a-random-string-min-32-chars
JWT_SECRET=change-this-to-another-random-string-min-32-chars

LOCAL_MODEL_URL=http://localhost:1234/v1
LOCAL_MODEL_NAME=local-model

LOG_LEVEL=debug
NEXT_PUBLIC_REACT_QUERY_DEVTOOLS=true
```

以 `cyanlog-sales-v3/.env.example` 为准，不再使用其他旧模板。

---

## 7. 当前代码位置

当前可运行代码的关键入口：

- `cyanlog-sales-v3/app/page.tsx`
- `cyanlog-sales-v3/app/layout.tsx`
- `cyanlog-sales-v3/app/globals.css`
- `cyanlog-sales-v3/components/`
- `cyanlog-sales-v3/lib/`

当前应用还是工作台骨架页，不包含登录流、Dashboard 路由或完整业务模块。

---

## 8. 启动验证

### 8.1 启动开发服务器

```bash
# 启动 Next.js 开发服务器
cd /Users/nsss/Price-v3/cyanlog-sales-v3
pnpm dev

# 访问 http://localhost:3000
```

### 8.2 验证检查清单

| 检查项 | 预期结果 |
|--------|---------|
| 访问 / | 显示销售报价工作台骨架页 |
| `pnpm lint` | 无 ESLint 报错 |
| `pnpm build` | 构建成功 |
| `.env.local` | 位于 `cyanlog-sales-v3/.env.local` |
| 本地模型接口（可选） | curl 返回正常响应 |

---

## 9. 常见问题

### 9.1 端口冲突

```bash
# 检查端口占用
lsof -i :3000
lsof -i :1234

# 更换端口
pnpm dev --port 3001
```

### 9.2 Supabase 连接失败

```bash
# 当前默认推荐云端 Supabase。
# 如果你使用官方 CLI，再根据自己的安装方式执行 stop/start/logs。
```

### 9.3 模型连接失败

```bash
# 检查本地模型服务是否启动
# 检查端口是否正确
# 检查目标模型是否正在提供服务
```

---

## 10. 下一步开发任务

环境准备完成后，按以下顺序开发：

1. **认证中心**：登录/退出、Token管理、路由守卫（2天）
2. **工作台框架**：布局、侧边栏、菜单权限（1天）
3. **合同上传**：文件上传、列表展示（2天）
4. **合同审核**：解析、规则引擎对接、报告展示（4天）
5. **报价中心**：CRUD、金额计算、审批流（3天）

---

## 附录：领域示例 SQL（非当前生效迁移入口）

以下 SQL 仅用于表达早期领域建模意图，不是当前业务仓的正式 schema SoT，也不是可直接部署的迁移入口。

当前如果要正式开始后端表结构开发，应以独立的 schema/migration 目录为准，并遵循：
- `/Users/nsss/Price-v3/harness-manager-治理管理/truth-docs-治理真相文档/DB_SCHEMA_GOVERNANCE.md`
- 未来落在 `cyanlog-sales-v3` 内的实际迁移文件

```sql
-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'SALES',
  dept_id UUID,
  avatar_url TEXT,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 合同表
CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255) NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  size INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'PENDING',
  parsed_text TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 报价单表
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no VARCHAR(50) UNIQUE NOT NULL,
  customer_name VARCHAR(200) NOT NULL,
  customer_phone VARCHAR(20),
  subtotal DECIMAL(15, 2) DEFAULT 0,
  tax_amount DECIMAL(15, 2) DEFAULT 0,
  discount_amount DECIMAL(15, 2) DEFAULT 0,
  total_amount DECIMAL(15, 2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'DRAFT',
  valid_until DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 启用 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
```
