# 性能问题根因分析与强提醒机制设计

**文档编号**: ROOT-CAUSE-PERF-001  
**日期**: 2026-06-16  
**状态**: 已确认  

---

## 一、根因分析：为什么功能不多但性能问题严重？

### 1.1 表面现象 vs 根本原因

| 表面现象 | 根本原因 | 责任环节 |
|---------|---------|---------|
| 组织架构页面 TTFB 1.9s | 数据库查询无索引，全表扫描 | 数据库设计 |
| API 响应慢 | 单路由处理5种业务，耦合严重 | 架构设计 |
| LCP 7s | Streaming SSR 阻塞式数据获取 | 渲染策略选择 |
| 重复请求 | 组件生命周期管理混乱 | 前端状态管理 |

### 1.2 五大根因（按影响排序）

#### 根因 1：需求阶段缺失性能验收标准
**问题描述**：
- 需求文档（REQ_REGISTRY.yml / feature-packets）无性能指标
- 用户故事不写「验收标准」中的性能约束
- 技术评审不检查性能可行性

**具体表现**：
```yaml
# 错误示例（当前）
REQ-001:
  title: 组织架构管理
  description: 支持部门/用户/角色的增删改查
  # 缺少性能验收标准

# 正确示例（应有）
REQ-001:
  title: 组织架构管理
  description: 支持部门/用户/角色的增删改查
  acceptance_criteria:
    performance:
      - 页面加载 LCP < 2.5s（P95）
      - API 响应时间 P95 < 500ms（1000条数据）
      - 并发 50 用户无降级
```

#### 根因 2：数据库设计阶段无索引规划
**问题描述**：
- 表设计只关注字段类型，不分析查询场景
- 外键字段无索引（org_id, user_id 等高频查询字段）
- 上线后发现问题才补索引（事后救火）

**具体表现**：
```sql
-- 表设计文档（当前）只定义字段
CREATE TABLE users (
  id UUID PRIMARY KEY,
  org_id UUID,  -- 无索引！高频查询字段
  email TEXT,
  created_at TIMESTAMP
);

-- 应有索引规划
CREATE INDEX idx_users_org_id ON users(org_id);  -- 必须
CREATE INDEX idx_users_org_created ON users(org_id, created_at DESC);  -- 列表查询
```

#### 根因 3：API 设计阶段无缓存策略
**问题描述**：
- 不区分动态/静态数据
- 默认所有数据实时查询
- 无 Cache-Control 配置

**具体表现**：
```typescript
// 当前做法（全动态）
export async function GET() {
  const data = await db.query(...);  // 每次请求都查
  return NextResponse.json(data);
}

// 应有策略
export async function GET() {
  const data = await fetchWithCache('org-data', () => db.query(...), 60);
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 's-maxage=60' }
  });
}
```

#### 根因 4：渲染策略选择不当
**问题描述**：
- 后台管理页面使用 SSR（需要 SEO？不需要）
- Streaming SSR 阻塞式等待数据
- 客户端渲染能力未利用

**具体表现**：
```typescript
// 当前（阻塞渲染）
export default async function Page() {
  const data = await fetch('/api/admin/org');  // 服务端等待
  return <OrgStructure data={data} />;  // HTML 流被卡
}

// 应有策略（客户端获取）
export default function Page() {
  return <OrgStructureClient />;  // 先渲染，数据客户端拉
}
```

#### 根因 5：缺少性能监控与告警
**问题描述**：
- 上线后无性能监控（Vercel Analytics 未配置）
- 慢查询无日志记录
- 性能劣化无感知，直到用户投诉

**具体表现**：
- `/api/products` 2.35s 运行数周无人知晓
- 数据库连接池耗尽无告警
- 前端 LCP 7s 无监控数据

---

## 二、强提醒机制设计

### 2.1 机制目标

**核心目标**：在开发流程的关键节点强制插入性能检查，使性能问题「不可跳过」。

**设计原则**：
1. **早发现**：在问题成本最低的环节发现（需求 > 设计 > 开发 > 测试 > 上线）
2. **强阻断**：不满足性能标准时，流程无法继续
3. **自动化**：减少人工检查，依赖工具和脚本

### 2.2 五道防线（Defense in Depth）

```
┌─────────────────────────────────────────────────────────────┐
│                    性能强提醒机制全景                         │
├─────────────┬───────────────────────────────────────────────┤
│ 防线 1      │ 需求评审强制检查（人工 + 清单）                │
│ 触发时机    │ REQ 状态流转：Draft → Ready                    │
│ 阻断条件    │ 性能验收标准缺失                               │
├─────────────┼───────────────────────────────────────────────┤
│ 防线 2      │ 表设计强制索引声明（Schema 注释）               │
│ 触发时机    │ 创建 migration 文件时                          │
│ 阻断条件    │ 高频查询字段无索引说明                         │
├─────────────┼───────────────────────────────────────────────┤
│ 防线 3      │ API 设计强制缓存声明（Code Review 检查）        │
│ 触发时机    │ PR 创建时                                      │
│ 阻断条件    │ 列表/详情 API 无缓存策略                       │
├─────────────┼───────────────────────────────────────────────┤
│ 防线 4      │ 提交前性能测试（Git Hook）                      │
│ 触发时机    │ git commit 时                                  │
│ 阻断条件    │ Lighthouse CI 分数 < 90                        │
├─────────────┼───────────────────────────────────────────────┤
│ 防线 5      │ 部署后性能监控（Vercel Analytics）              │
│ 触发时机    │ 每次部署后                                     │
│ 阻断条件    │ Core Web Vitals 未达标（连续3次）              │
└─────────────┴───────────────────────────────────────────────┘
```

### 2.3 防线 1：需求评审强制检查

**检查清单（Performance Checklist）**：

```markdown
## REQ 性能验收标准检查清单

- [ ] 页面加载性能
  - [ ] LCP 目标值：< ___ s（默认 2.5s）
  - [ ] FCP 目标值：< ___ s（默认 1.5s）
  
- [ ] API 响应性能
  - [ ] 列表查询 P95：< ___ ms（默认 500ms，1000条数据）
  - [ ] 详情查询 P95：< ___ ms（默认 300ms）
  - [ ] 创建/更新 P95：< ___ ms（默认 800ms）

- [ ] 数据量假设
  - [ ] 预期最大数据量：___ 条（默认 10000）
  - [ ] 并发用户数：___（默认 50）

- [ ] 缓存策略
  - [ ] 静态数据缓存时间：___ s（默认 60s）
  - [ ] 动态数据缓存时间：___ s（默认 30s）

- [ ] 降级策略
  - [ ] 超时降级时间：___ s（默认 5s）
  - [ ] 降级后行为：___（默认显示缓存数据/骨架屏）

**未填写项说明**：
- 如某项不适用，填写「N/A」并说明原因
- 如未填写，默认采用上述建议值
```

**实施方式**：
1. 在 `REQ_REGISTRY.yml` 中增加 `performance_acceptance_criteria` 字段
2. REQ 状态从 Draft → Ready 时，必须填写性能检查清单
3. AI 辅助检查清单完整性

### 2.4 防线 2：表设计强制索引声明

**Schema 注释规范**：

```sql
-- migration 文件模板（强制索引声明）

/*
表用途: 用户管理
预期数据量: 10万条
高频查询场景:
  1. 按 org_id 查询用户列表（每日1000次）-> 需索引
  2. 按 email 查询用户（每日500次）-> 需索引
  3. 按 org_id + created_at 排序（每日800次）-> 需复合索引

索引设计:
  - idx_users_org_id: users(org_id) - 场景1
  - idx_users_email: users(email) - 场景2
  - idx_users_org_created: users(org_id, created_at DESC) - 场景3
*/

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,  -- 高频查询字段，需索引
  email TEXT NOT NULL UNIQUE,  -- 唯一查询，需索引
  created_at TIMESTAMP DEFAULT now(),
  
  -- 索引声明（强制）
  CONSTRAINT fk_users_org FOREIGN KEY (org_id) REFERENCES organizations(id)
);

-- 索引创建（必须与注释一致）
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_org_created ON users(org_id, created_at DESC);
```

**实施方式**：
1. 创建 migration 文件时，必须包含「表用途/预期数据量/高频查询场景/索引设计」注释
2. CI 检查：解析注释中的索引列表，与文件中的 CREATE INDEX 语句比对，不一致则阻断

### 2.5 防线 3：API 设计强制缓存声明

**API 注释规范**：

```typescript
/**
 * @api {get} /api/admin/org 获取组织架构
 * @apiName GetOrgStructure
 * @apiGroup Organization
 * 
 * @apiCache {strategy} stale-while-revalidate
 * @apiCache {maxAge} 30  // 秒
 * @apiCache {staleWhileRevalidate} 120  // 秒
 * 
 * @apiPerformance {p95} 500ms  // 1000条数据
 * @apiPerformance {cacheHitRate} >80%  // 目标缓存命中率
 * 
 * @apiDataType {static} departments  // 部门列表，变化不频繁
 * @apiDataType {dynamic} users  // 用户列表，实时性要求高
 */
export async function GET(req: NextRequest) {
  // 实现必须与注释一致
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120'
    }
  });
}
```

**实施方式**：
1. API 路由文件必须包含 JSDoc 注释，声明缓存策略和性能目标
2. PR 时 Code Review 检查：注释与实际代码是否一致
3. 未声明缓存策略的 API，默认阻断合并

### 2.6 防线 4：提交前性能测试（Git Hook）

**`.husky/pre-commit`**：

```bash
#!/bin/bash

echo "🚀 运行性能检查..."

# 1. Lighthouse CI（页面性能）
npx lhci autorun --config=lighthouserc.js || {
  echo "❌ Lighthouse CI 失败，性能分数 < 90"
  exit 1
}

# 2. 数据库查询分析（检查慢查询）
npx tsx scripts/check-slow-queries.ts || {
  echo "❌ 发现潜在慢查询，请添加索引"
  exit 1
}

# 3. Bundle 分析（检查包体积）
npx tsx scripts/check-bundle-size.ts || {
  echo "❌ Bundle 体积超过阈值"
  exit 1
}

echo "✅ 性能检查通过"
```

**`lighthouserc.js`**：

```javascript
module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:3000/configs'],
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'first-contentful-paint': ['error', { maxNumericValue: 1500 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
      },
    },
  },
};
```

### 2.7 防线 5：部署后性能监控（Vercel Analytics）

**Vercel Analytics 配置**：

```typescript
// app/layout.tsx
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />  {/* Core Web Vitals 监控 */}
        <SpeedInsights />  {/* 真实用户性能数据 */}
      </body>
    </html>
  );
}
```

**告警规则**：

```yaml
# vercel-alerts.yml
alerts:
  - name: LCP 劣化
    metric: web_vitals_lcp
    threshold: 2500  # ms
    duration: 10m  # 持续10分钟
    severity: critical

  - name: API 响应慢
    metric: api_response_time_p95
    threshold: 1000  # ms
    duration: 5m
    severity: warning

  - name: 错误率上升
    metric: error_rate
    threshold: 0.01  # 1%
    duration: 5m
    severity: critical

notifications:
  slack: '#alerts-performance'
  email: 'tech-lead@company.com'
```

**自动回滚**：
- 连续 3 次部署后 Core Web Vitals 未达标 → 自动回滚到上一个稳定版本

---

## 三、实施路线图

### Phase 1：立即实施（本周）

| 任务 | 负责人 | 完成标准 |
|------|--------|---------|
| 更新 REQ 模板 | Tech Lead | REQ_REGISTRY.yml 包含性能验收字段 |
| 配置 Vercel Analytics | DevOps | Dashboard 可见 Core Web Vitals 数据 |
| 迁移现有 REQ | PM | 所有活跃 REQ 补充性能验收标准 |

### Phase 2：短期实施（本月）

| 任务 | 负责人 | 完成标准 |
|------|--------|---------|
| 数据库索引清单 | DBA | 所有高频查询字段有索引 |
| API 缓存策略 | Backend | 所有列表/详情 API 有 Cache-Control |
| Lighthouse CI | Frontend | CI 失败时阻断合并 |

### Phase 3：长期实施（下季度）

| 任务 | 负责人 | 完成标准 |
|------|--------|---------|
| 自动化性能回归 | QA | 每次发布自动跑性能测试 |
| 性能告警闭环 | DevOps | P95 > 1s 自动告警并通知 |
| 性能预算制度 | Architect | 新功能开发前有性能预算 |

---

## 四、检查清单（Checklist）

### 新增功能开发检查清单

```markdown
## 新功能性能检查清单

### 需求阶段
- [ ] REQ 文档包含性能验收标准
- [ ] 数据量假设已明确（最大数据量/并发）
- [ ] 缓存策略已确定（静态/动态/不缓存）

### 设计阶段
- [ ] 数据库表设计包含索引规划注释
- [ ] API 设计包含缓存策略注释
- [ ] 渲染策略已选择（CSR/SSR/SSG/ISR）

### 开发阶段
- [ ] 代码包含性能关键路径注释
- [ ] 单元测试包含性能边界测试
- [ ] Lighthouse CI 分数 > 90

### 上线阶段
- [ ] Vercel Analytics 已配置
- [ ] 性能告警规则已配置
- [ ] 降级策略已验证

### 验收阶段
- [ ] 实际性能数据符合 REQ 标准
- [ ] 缓存命中率 > 80%
- [ ] 无慢查询（> 500ms）
```

---

## 五、文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| 母文档性能规范 | `00-master/PROJECT-主文档.md` S.7.3 | 性能设计缺陷与规范 |
| API 契约文档 | `04-implementation-truth/API_CONTRACT_ORG_ADMIN.md` | 路由拆分契约 |
| 四维评估报告 | `04-implementation-truth/FOUR_DIMENSION_ASSESSMENT.md` | 系统评估 |
| 暗桩分析 | `04-implementation-truth/CHARACTERIZATION_TESTS.md` | 副作用分析 |

---

**结论**：性能问题的根因不是「代码写得不好」，而是「流程中缺少性能环节」。五道防线机制确保性能问题在成本最低的环节被发现和修复。
