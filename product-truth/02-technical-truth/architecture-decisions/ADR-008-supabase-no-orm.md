# ADR-008: Supabase直接查询（无ORM）

## 状态
已采纳 (2026-05-21)

## 背景 (Context)

销售管理系统的数据访问层选型：

1. **数据库类型**：
   - PostgreSQL（Supabase托管）
   - 已选定（见ADR-006）

2. **业务特点**：
   - 表结构稳定（无需频繁迁移）
   - 复杂关联查询（多表JOIN）
   - 实时订阅需求（Supabase Realtime）
   - RLS行级安全（声明式权限）

3. **团队约束**：
   - 已有Supabase使用经验
   - 不想引入额外学习成本
   - 优先快速开发

4. **性能需求**：
   - Supabase JS SDK已优化
   - 复杂查询需要原生SQL能力

## 决策 (Decision)

采用**Supabase JS SDK + 直接SQL查询**（不引入ORM）：

### 访问层
```typescript
// 直接查询
const { data, error } = await supabaseAdmin
  .from('quotes')
  .select('*, customer:customers(name)')
  .eq('status', 'DRAFT')
  .order('created_at', { ascending: false })
  .limit(20)

// 原生SQL（复杂场景）
const { data } = await supabaseAdmin.rpc('generate_quote_number')

// 存储过程（事务性操作）
const { data } = await supabaseAdmin.rpc('close_deal', { deal_id })
```

### 类型生成
```bash
# 自动生成TypeScript类型
npx supabase gen types typescript --project-id xxx > lib/types/db.ts
```

### 查询模式
| 场景 | 方式 | 工具 |
|------|------|------|
| 简单CRUD | Query Builder | supabase.from().select() |
| 复杂聚合 | RPC | supabase.rpc() |
| 事务 | RPC (内部BEGIN/COMMIT) | PostgreSQL函数 |
| 实时订阅 | Realtime | supabase.channel() |
| 大批量 | 原生SQL | supabase.rpc()返回SETOF |

## 影响 (Consequences)

### 正面影响
- ✅ **零学习成本**：直接写SQL-like API
- ✅ **Realtime原生**：Supabase订阅直接支持
- ✅ **RLS集成**：声明式权限，避免应用层处理
- ✅ **性能可预测**：生成的SQL可优化
- ✅ **类型安全**：自动生成TypeScript类型

### 负面影响
- ⚠️ **无对象映射**：手动处理数据结构
- ⚠️ **复杂JOIN繁琐**：需要理解Supabase select语法
- ⚠️ **N+1风险**：必须手动管理关联查询
- ⚠️ **迁移不自动**：schema变更需手动同步

## 备选方案 (Alternatives Considered)

### 备选A：Prisma
- 类型生成强大
- 但**与Supabase RLS有冲突**（Prisma直接连接，绕过RLS）
- 部署Vercel需要Prisma Accelerate（额外费用）
- Schema定义重复（Prisma + Supabase）
- **否决原因**：与Supabase集成有摩擦

### 备选B：Drizzle
- 轻量，TypeScript原生
- 性能好
- 但**生态比Supabase小**
- 实时订阅需要额外集成
- **否决原因**：与Supabase集成度不如原生SDK

### 备选C：Kysely
- 纯TypeSQL
- 类型推导好
- 但**无Realtime支持**
- 需手写所有schema定义
- **否决原因**：与Supabase生态不匹配

### 备选D：原生pg库
- 性能最佳
- 但**连接池管理复杂**
- 类型安全差
- **否决原因**：开发效率低

## 实施细节 (Implementation)

### 类型生成
```bash
# 定期生成类型
supabase gen types typescript --linked > lib/types/database.ts
```

### 关联查询模式
```typescript
// 单个关联
.select('id, name, customer:customers(name)')

// 多个关联
.select(`
  id, name,
  customer:customers(name, industry),
  owner:users!owner_id(display_name)
`)

// 嵌套关联
.select(`
  id, status,
  items:quote_items(
    product:products(name, price)
  )
`)
```

### 性能陷阱
```typescript
// ❌ N+1：先查列表，再查每个详情
const quotes = await supabase.from('quotes').select('*')
for (const q of quotes.data) {
  const items = await supabase.from('quote_items').select('*').eq('quote_id', q.id)
}

// ✅ 一次查询：使用JOIN
const quotesWithItems = await supabase
  .from('quotes')
  .select('*, items:quote_items(*)')
```

## 验证标准 (Validation)

| 指标 | 目标值 |
|------|--------|
| 查询性能 | 与原生SQL差距 <5ms |
| 类型覆盖率 | >95% |
| N+1查询 | 0 |
| RLS策略审查 | 季度审计 |

## 参考 (References)

- ADR-006 PostgreSQL数据库选型
- Supabase文档：https://supabase.com/docs/reference/javascript
- 项目代码：`lib/supabase.ts`（已封装客户端）
