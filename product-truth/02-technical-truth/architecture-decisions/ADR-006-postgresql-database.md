# ADR-006: PostgreSQL数据库选型

## 状态
已采纳 (2026-05-21)

## 背景 (Context)

销售管理系统需要关系型数据库存储核心业务数据：

1. **数据结构**：
   - 用户/组织/角色（多对多关系）
   - 报价/合同/审批（强事务）
   - 配置/规则（结构化JSON）
   - 日志/审计（时序数据）

2. **查询模式**：
   - 复杂关联查询（报价JOIN产品JOIN客户）
   - 全文搜索（合同内容）
   - 范围查询（按时间/金额）
   - 聚合统计（销售业绩）

3. **一致性要求**：
   - 财务数据强一致性
   - 多步骤业务流程需事务
   - 跨表数据完整性

4. **生态约束**：
   - Supabase提供托管PostgreSQL
   - Next.js社区多PostgreSQL方案
   - Vercel对PostgreSQL支持良好

## 决策 (Decision)

采用**PostgreSQL 15+ (Supabase托管)**：

### 选型理由
1. **JSONB原生支持**：配置/规则字段可结构化存储且支持索引
2. **全文搜索**：内置`tsvector`支持合同内容检索
3. **RLS（行级安全）**：Supabase集成，可声明式权限控制
4. **事务隔离**：READ COMMITTED满足业务需求
5. **生态成熟**：Prisma/TypeORM/Drizzle均有良好支持

### 关键Schema决策
- 主键：`UUID`（避免ID暴露+支持分布式）
- 时间戳：`TIMESTAMPTZ`（带时区）
- 金额：`NUMERIC(15,2)`（避免浮点误差）
- 枚举：`TEXT + CHECK约束`（便于演进）
- JSONB：仅用于配置/元数据，不存核心业务字段

### 性能策略
| 场景 | 索引类型 | 示例 |
|------|---------|------|
| 精确查询 | B-tree | `users(email)` UNIQUE |
| 范围查询 | B-tree | `quotes(created_at)` |
| 全文搜索 | GIN | `contracts(content) tsvector` |
| JSONB查询 | GIN | `roles(permissions)` |
| 统计查询 | BRIN | `audit_logs(created_at)` |

## 影响 (Consequences)

### 正面影响
- ✅ **类型安全**：与TypeScript协同好（生成types）
- ✅ **强事务**：ACID保证
- ✅ **JSONB灵活**：配置/规则无需DDL变更
- ✅ **生态丰富**：Supabase简化开发
- ✅ **可观测**：pg_stat_statements内置

### 负面影响
- ⚠️ **运维复杂**：需要备份/恢复/索引维护
- ⚠️ **连接数有限**：PgBouncer/Supavisor必需
- ⚠️ **迁移风险**：DDL变更需谨慎

## 备选方案 (Alternatives Considered)

### 备选A：MySQL 8.0
- 运维成熟，生态完善
- 但**JSON支持弱**（直到8.0才完善）
- **否决原因**：JSONB是核心需求

### 备选B：MongoDB
- Schema灵活
- 但**事务支持差**（4.0+才有多文档事务）
- 关联查询能力弱
- **否决原因**：财务数据强事务要求

### 备选C：SQLite
- 部署简单
- 但**并发写入弱**
- 不支持多用户同时编辑
- **否决原因**：并发要求

## 实施细节 (Implementation)

### Supabase配置
```sql
-- 启用必要扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- 三元组索引
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;  -- 查询统计
```

### TypeScript类型生成
```bash
npx supabase gen types typescript --project-id xxx > lib/types/db.ts
```

### 连接池
- Supabase自动提供Supavisor
- 服务端使用SERVICE_ROLE_KEY直连
- 客户端使用ANON_KEY经RLS过滤

## 验证标准 (Validation)

| 指标 | 目标值 |
|------|--------|
| P95查询延迟 | <50ms |
| 慢查询数量 | 0（>1s） |
| 连接池利用率 | <80% |
| 备份恢复演练 | 季度一次 |

## 参考 (References)

- 母文档：技术架构.md
- Supabase文档：https://supabase.com/docs
- 项目Schema：`supabase/migrations/`
