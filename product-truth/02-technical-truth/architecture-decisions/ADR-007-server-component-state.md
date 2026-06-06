# ADR-007: Next.js服务端组件与最小客户端状态

## 状态
已采纳 (2026-05-21)

## 背景 (Context)

销售管理系统的前端状态管理需求：

1. **数据流特征**：
   - 服务端组件（Server Component）为主：直接查询DB
   - 客户端状态：登录态、临时表单、UI状态
   - 跨页面状态：当前销售空间、用户角色

2. **避免过度状态化**：
   - React useState滥用导致状态同步问题
   - 全局状态管理（Redux）增加心智负担
   - URL状态应该是首选（可分享、可前进后退）

3. **技术栈一致性**：
   - Next.js 14 App Router原生支持服务端组件
   - React Server Components (RSC) 减少JS bundle
   - 避免引入额外状态管理库

## 决策 (Decision)

采用**"服务端组件优先 + useState局部 + URL状态"**分层策略：

### 状态分层
| 状态类型 | 存储位置 | 工具 | 适用场景 |
|---------|---------|------|---------|
| 服务端数据 | 服务端查询 | RSC + Supabase | 列表/详情 |
| 表单临时态 | useState | React | 多步表单 |
| UI状态 | useState | React | 弹窗/折叠 |
| 跨页面 | URL | Next.js Router | 搜索/筛选/分页 |
| 认证态 | cookie + middleware | Next.js | 登录/角色 |
| 实时数据 | SWR/React Query | 客户端 | 通知/倒计时 |

### 原则
1. **能服务端查询就不传props**：减少prop drilling
2. **能用URL就不useState**：可分享、可前进后退
3. **能用useState就不Context**：避免Provider地狱
4. **能用Context就不Redux**：保持简单
5. **客户端不直接查DB**：必须经API层

### 异常使用场景
- 表单多步骤：useState管理（不持久化）
- 实时通知：SSE+本地缓存
- 复杂表单：React Hook Form + Zod

## 影响 (Consequences)

### 正面影响
- ✅ **JS bundle小**：服务端组件不下载
- ✅ **SSR友好**：SEO+首屏快
- ✅ **心智简单**：无全局store
- ✅ **URL可分享**：筛选/搜索条件可分享
- ✅ **类型安全**：服务端直接用TypeScript查询

### 负面影响
- ⚠️ **交互受限**：服务端组件无事件处理
- ⚠️ **表单体验**：需配合useState + Server Actions
- ⚠️ **实时性弱**：需额外机制（SWR轮询/SSE）

## 备选方案 (Alternatives Considered)

### 备选A：Redux Toolkit
- DevTools强大
- 但**对中小项目过度设计**
- 心智负担大（action/reducer）
- 80%场景useState足够
- **否决原因**：复杂度与价值不匹配

### 备选B：Zustand
- 轻量（~1KB）
- 介于useState和Redux之间
- 但**目前没有跨组件深度共享需求**
- **否决原因**：过早引入

### 备选C：Jotai/Recoil
- 原子化状态
- 但**学习曲线**
- 团队需要适应
- **否决原因**：当前复杂度不需要

### 备选D：React Query全量
- 适合实时数据
- 但**普通列表不需要客户端缓存**
- 服务端组件直接查询更高效
- **否决原因**：场景重叠

## 实施细节 (Implementation)

### 服务端组件查询
```typescript
// app/products/page.tsx (Server Component)
export default async function ProductsPage() {
  const { data } = await supabaseAdmin.from('products').select('*')
  return <ProductList products={data} />
}
```

### URL状态管理
```typescript
// 使用Next.js useSearchParams
const searchParams = useSearchParams()
const status = searchParams.get('status')

// 更新URL触发重新查询
const updateFilter = (status: string) => {
  router.push(`?status=${status}`)
}
```

### 表单状态
```typescript
// 多步表单
const [step, setStep] = useState(1)
const [formData, setFormData] = useState({...})

// 服务端提交
<form action={serverAction}>...</form>
```

## 验证标准 (Validation)

| 指标 | 目标值 |
|------|--------|
| 客户端JS bundle | <200KB |
| 首屏TTI | <1s |
| 状态管理库 | 0（只用React内置） |
| 服务端组件占比 | >80% |

## 参考 (References)

- 母文档 X.34 后端架构详细设计
- Next.js文档：https://nextjs.org/docs/app
- React Server Components：https://react.dev/blog/2023/03/22/react-labs-what-we-have-been-working-on-march-2023
