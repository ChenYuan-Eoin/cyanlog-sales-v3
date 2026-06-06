# 架构决策记录索引 (ADR INDEX)

> 记录项目中的关键技术决策，帮助团队理解"为什么这样设计"。
> 格式参考：Michael Nygard 的 ADR 模板

## 决策清单

| 编号 | 标题 | 状态 | 影响模块 |
|------|------|------|----------|
| [ADR-001](./ADR-001-ai-failover-chain.md) | AI服务多级降级链架构 | 已采纳 | 合同审核、可靠性 |
| [ADR-002](./ADR-002-jwt-db-token.md) | JWT与数据库Token双轨存储 | 已采纳 | 认证、安全 |
| [ADR-003](./ADR-003-sse-streaming.md) | SSE流式传输选型 | 已采纳 | 实时通信 |
| [ADR-004](./ADR-004-rbac-scope.md) | RBAC权限模型与数据范围隔离 | 已采纳 | 权限、数据隔离 |
| [ADR-005](./ADR-005-middleware-layering.md) | Next.js Middleware分层认证架构 | 已采纳 | 认证、入口控制 |
| [ADR-006](./ADR-006-postgresql-database.md) | PostgreSQL数据库选型 | 已采纳 | 数据存储 |
| [ADR-007](./ADR-007-server-component-state.md) | 服务端组件与最小客户端状态 | 已采纳 | 前端架构 |
| [ADR-008](./ADR-008-supabase-no-orm.md) | Supabase直接查询（无ORM） | 已采纳 | 数据访问层 |
| [ADR-009](./ADR-009-supabase-storage.md) | Supabase Storage文件存储 | 已采纳 | 文件管理 |
| [ADR-010](./ADR-010-paddle-ocr.md) | PaddleOCR本地OCR服务 | 已采纳 | 文档处理 |

## 决策分布

```
ADR总数: 10
├── 可靠性/降级 (1)
│   └── ADR-001 AI多级降级链
├── 安全/认证 (2)
│   ├── ADR-002 Token双轨存储
│   └── ADR-005 Middleware分层
├── 通信协议 (1)
│   └── ADR-003 SSE流式
├── 权限/数据 (1)
│   └── ADR-004 RBAC + Scope
├── 数据存储 (3)
│   ├── ADR-006 PostgreSQL
│   ├── ADR-008 无ORM直接查询
│   └── ADR-009 Supabase Storage
├── 前端架构 (1)
│   └── ADR-007 服务端组件优先
└── 文档处理 (1)
    └── ADR-010 PaddleOCR
```

## ADR模板

```markdown
# ADR-{编号}: {决策标题}

## 状态
{草案/已采纳/已废弃/已替换} ({日期})

## 背景 (Context)
{什么场景下需要做这个决策？面临什么问题？}

## 决策 (Decision)
{我们决定怎么做？关键参数是什么？}

## 影响 (Consequences)
### 正面影响
- ✅ {...}
### 负面影响
- ⚠️ {...}

## 备选方案 (Alternatives Considered)
### 备选A：{方案名}
- 优点：{...}
- 否决原因：{...}

## 实施细节 (Implementation)
{代码示例、配置、关键路径}

## 验证标准 (Validation)
{如何确认这个决策是成功的？可测量指标}

## 参考 (References)
{相关代码、文档、外部资料}
```

## 待编写ADR

- [x] ~~ADR-006: 数据库选型~~ ✅
- [x] ~~ADR-007: 状态管理方案~~ ✅
- [x] ~~ADR-008: ORM选型~~ ✅
- [x] ~~ADR-009: 文件存储~~ ✅
- [x] ~~ADR-010: OCR服务~~ ✅

### 未来待编写
- [ ] ADR-011: 部署架构（Vercel + Supabase多区域）
- [ ] ADR-012: 监控告警体系（APM + 业务指标）
- [ ] ADR-013: CI/CD流水线（GitHub Actions）
- [ ] ADR-014: 国际化方案（next-intl）
- [ ] ADR-015: 错误处理与重试策略

## 维护规则

1. **新建ADR**：使用下一个可用编号，文件命名 `ADR-{编号}-{slug}.md`
2. **状态变更**：在原ADR中修改状态字段，不删除旧ADR
3. **决策反转**：新建新ADR引用旧ADR，不要修改历史记录
4. **评审周期**：每季度回顾一次，确认ADR仍符合当前架构

## 维护者
AI Assistant + 项目所有者

最后更新：2026-06-07
