<!--
文件名: CONFIGURATION.md
用途: 配置管理规范 - 敏感信息存放与访问控制
所属层: 治理层
创建者: AI Assistant
更新规则: 新增配置项时更新
REQ: GOV-CFG-001
-->

# 配置管理规范

## 当前有效入口

当前仓库的环境变量治理不是只靠本文档，而是以下三处共同构成：

| 入口 | 角色 | 是否机器可读 |
|------|------|-------------|
| `product-truth/product-code/.env.example` | 当前业务模板（SoT） | 是 |
| `.env.example` | 工作区参考模板 | 是 |
| `harness-manager-治理管理/runtime-config-AI运行配置/config-配置文件/env-registry-环境变量注册表.json` | 当前有效注册表 | 是 |
| `harness-manager-治理管理/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json` | 项目治理注册表 | 是 |
| `harness-manager-治理管理/guide-harness治理指南.md` | 治理归属说明 | 否 |

本文档负责解释规则，不单独承担“唯一真相”职责。

## 核心原则

| 原则 | 说明 | 违规后果 |
|------|------|---------|
| **敏感信息不入代码** | API Key、密码、私钥等不得出现在 git 历史 | 安全审计失败 |
| **环境分离** | 开发/测试/生产配置隔离 | 误操作风险 |
| **显式声明** | 所有业务配置项必须同时在 `product-truth/product-code/.env.example` 和注册表中声明 | 配置遗漏 |
| **最小权限** | 生产环境使用最小权限凭证 | 泄露风险 |

---

## 配置项清单

### 环境配置文件

| 文件 | 用途 | 是否入git | 说明 |
|------|------|----------|------|
| `product-truth/product-code/.env.example` | 业务配置模板 | ✅ 是 | 当前业务应用使用的模板文件 |
| `.env.example` | 工作区参考模板 | ✅ 是 | 根目录文档 / 基础设施说明使用的参考默认值 |
| `.env.local` | 本地开发 | ❌ 否 | 本地环境变量，不提交 |
| `.env.production` | 生产环境 | ❌ 否 | 仅部署服务器持有 |
| `.env.development` | 开发环境 | ❌ 否 | 团队共享但不入git |
| `env-registry-环境变量注册表.json` | 配置注册表 | ✅ 是 | 机器可读的配置清单与归属信息 |

### 敏感信息分类

#### 🔴 极高敏感（绝对不可入代码）
```
API Key (OpenAI, Anthropic, etc.)
数据库密码
JWT 私钥
SSH 私钥
支付密钥
```

#### 🟡 中等敏感（环境变量管理）
```
数据库连接字符串（不含密码部分）
API 端点地址
功能开关配置
访问控制白名单
```

#### 🟢 低敏感（可入代码）
```
页面标题
分页默认值
默认时区
缓存时间配置
```

---

## 本地化存储方案

### 方案：Browser LocalStorage + 用户自主管理

**适用场景**：F028 AI 合同审核系统

```typescript
// lib/api-keys.ts
interface ApiKeyConfig {
  provider: 'openai' | 'anthropic';
  key: string;
  lastValidated?: Date;
}

class ApiKeyManager {
  private readonly KEY_PREFIX = 'cyanlog_api_key_';

  setKey(provider: string, key: string): void {
    // 客户端存储，不上传服务器
    localStorage.setItem(this.KEY_PREFIX + provider, key);
  }

  getKey(provider: string): string | null {
    return localStorage.getItem(this.KEY_PREFIX + provider);
  }

  removeKey(provider: string): void {
    localStorage.removeItem(this.KEY_PREFIX + provider);
  }

  // 验证 Key 格式（不实际调用）
  validateFormat(provider: string, key: string): boolean {
    if (provider === 'openai') {
      return key.startsWith('sk-') && key.length >= 40;
    }
    return key.length >= 20;
  }
}

export const apiKeyManager = new ApiKeyManager();
```

**优势**：
- API Key 不经过服务器，不落地
- 用户完全掌控自己的密钥
- 符合数据最小化原则

---

## 环境变量模板

以 `product-truth/product-code/.env.example` 为准。下列片段仅用于说明，不替代模板文件。

### 开发环境 (.env.local)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-local-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-local-service-key

# Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-do-not-use-in-production
JWT_SECRET=replace-with-32-plus-char-secret

# Local model (optional)
LOCAL_MODEL_URL=http://localhost:1234/v1
LOCAL_MODEL_NAME=local-model

# Debug
LOG_LEVEL=debug
NEXT_PUBLIC_REACT_QUERY_DEVTOOLS=true
```

### 生产环境 (.env.production)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}

# Auth
NEXTAUTH_URL=https://your-app-domain.example
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
JWT_SECRET=${JWT_SECRET}

# Local model / fallback
LOCAL_MODEL_URL=${LOCAL_MODEL_URL}
LOCAL_MODEL_NAME=${LOCAL_MODEL_NAME}
```

---

## 预提交检查

### Hook: H006_配置检查

```bash
#!/bin/bash
# .git/hooks/pre-commit 配置检查部分

# 检查是否包含敏感信息
if git diff --cached | grep -iE '(password|secret|key|token)\s*=\s*["\047][^"\047]{8,}'; then
    echo "❌ 检测到可能的敏感信息"
    echo "   请在 .env 文件中配置，不要硬编码"
    exit 2
fi

# 检查 .env.* 文件是否被意外提交
if git diff --cached --name-only | grep -E '\.env\.(local|production|development)$'; then
    echo "❌ 环境配置文件不应提交到 git"
    echo "   已自动阻止 .env.* 文件提交"
    exit 2
fi

echo "✅ 配置检查通过"
```

---

## 配置项注册表

| 配置键 | 用途 | 敏感级别 | 存储位置 | 示例值 |
|--------|------|---------|---------|--------|
| `DATABASE_URL` | 主数据库连接 | 🔴 高 | 环境变量/部署平台 | postgresql://... |
| `REDIS_URL` | 缓存/队列连接 | 🟡 中 | 环境变量/部署平台 | redis://... |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目地址 | 🟡 中 | 环境变量 | https://xxx.supabase.co |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 客户端数据库访问 | 🔴 高 | 环境变量/Vercel | eyJhbGc... |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端数据库访问 | 🔴 高 | 环境变量/Vercel | eyJhbGc... |
| `NEXTAUTH_SECRET` | 认证签名密钥 | 🔴 高 | 环境变量/Vercel | （随机字符串） |
| `JWT_SECRET` | Token 签名 | 🔴 高 | 环境变量/Vercel | （随机字符串） |
| `ENCRYPTION_KEY` | 敏感字段加密 | 🔴 高 | 环境变量/Vercel | （32字节密钥） |
| `LOCAL_MODEL_URL` | 本地模型 OpenAI 兼容接口地址 | 🟡 中 | 环境变量 | http://localhost:1234/v1 |
| `LOCAL_MODEL_NAME` | 本地模型名称 | 🟢 低 | 环境变量 | local-model |
| `NEXT_PUBLIC_*` | 前端可访问配置 | 🟢 低 | 环境变量 | true/false |
| `OPENAI_API_KEY` | 服务端集成或本地调试 | 🔴 高 | Shell/.env/Vercel | sk-... |
| `ANTHROPIC_API_KEY` | 服务端集成或本地调试 | 🔴 高 | Shell/.env/Vercel | sk-ant-... |

说明：
- 若产品采用“终端用户自带 Key”模式，用户自己的 API Key 不写入本仓库环境文件。
- 这类 BYOK 方案属于产品设计，不替代项目运行时自己的环境变量治理。

---

## 部署检查清单

- [ ] `.env.production` 存在于部署服务器，不在 git 中
- [ ] Vercel Environment Variables 已配置
- [ ] Supabase 生产环境连接已测试
- [ ] `APP_SECRET` 是随机生成的强密钥
- [ ] 本地开发 `.env.local` 在 `.gitignore` 中

---

**合规声明**：本规范遵循 OWASP 配置管理最佳实践。
