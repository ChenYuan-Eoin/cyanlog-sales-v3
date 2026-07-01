import {
  apiRoutes,
  eventTypes,
  cacheLevels,
  perfTargets,
  securityConstraints,
  callPatterns,
  deploymentComparison,
  chapterTitles,
} from '@/lib/tech-architecture/data'

export const metadata = {
  title: '技术架构 - ONES Sales',
  description: '系统技术架构全景：服务调用、API 网关、事件总线、缓存、部署、安全',
}

export default function TechArchitecturePage() {
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* 页头 */}
      <header className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-2">技术架构</h1>
        <p className="text-slate-600 max-w-2xl">
          智能销售支撑平台的技术全景：服务间调用、API 网关、事件总线、缓存策略、部署架构、安全约束。
        </p>
      </header>

      {/* 顶部锚点导航 */}
      <nav className="mb-8 flex flex-wrap gap-2 text-sm" aria-label="技术架构内导航">
        {chapterTitles.map((c) => (
          <a
            key={c.id}
            href={`#${c.id}`}
            className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700"
          >
            <span className="mr-1">{c.icon}</span>
            {c.name}
          </a>
        ))}
      </nav>

      {/* 1. 服务间调用电路 */}
      <section id="services" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          <span className="mr-2">⚡</span>服务间调用电路
        </h2>
        <div className="rounded-lg border bg-white p-6">
          <pre className="text-xs font-mono text-slate-700 leading-relaxed overflow-x-auto">
{`客户端请求
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                      API Gateway                         │
│  • 路由分发 / 认证鉴权 / 限流熔断                        │
└────────────────┬───────────────────────────────────────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
  业务服务     事件总线      AI 服务
    │            │            │
    ▼            ▼            ▼
┌────────┐  ┌────────┐   ┌────────┐
│报价中心│  │Redis   │   │本地模型│
│合同审核│  │Stream  │   │云端模型│
│配置中心│  │        │   │规则引擎│
│标书中心│  │        │   │        │
└────────┘  └────────┘   └────────┘
    │            │            │
    ▼            ▼            ▼
┌────────┐  ┌────────┐   ┌────────┐
│PostgreSQL│  │Cache  │   │Object  │
│        │  │        │   │Storage │
└────────┘  └────────┘   └────────┘`}
          </pre>
        </div>
      </section>

      {/* 2. API 网关路由 */}
      <section id="gateway" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          <span className="mr-2">🚪</span>API 网关路由
        </h2>
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">路径前缀</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">服务</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">职责</th>
                </tr>
              </thead>
              <tbody>
                {apiRoutes.map((r) => (
                  <tr key={r.prefix} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-mono text-xs text-blue-700">{r.prefix}</td>
                    <td className="px-4 py-3 text-slate-900">{r.service}</td>
                    <td className="px-4 py-3 text-slate-600">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-slate-50 border-t text-xs text-slate-500">
            实现：Next.js API Routes + Middleware（认证、限流、错误处理）
          </div>
        </div>
      </section>

      {/* 3. 事件总线 */}
      <section id="events" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          <span className="mr-2">📨</span>事件总线
        </h2>
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">事件</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">触发条件</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">消费者</th>
                </tr>
              </thead>
              <tbody>
                {eventTypes.map((e) => (
                  <tr key={e.name} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-mono text-xs text-purple-700">{e.name}</td>
                    <td className="px-4 py-3 text-slate-700">{e.trigger}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {e.consumers.map((c) => (
                          <span
                            key={c}
                            className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 4. 缓存策略 */}
      <section id="cache" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          <span className="mr-2">💾</span>缓存策略
        </h2>
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">层级</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">技术</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">用途</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">过期</th>
                </tr>
              </thead>
              <tbody>
                {cacheLevels.map((c) => (
                  <tr key={c.level} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">{c.level}</td>
                    <td className="px-4 py-3 font-mono text-xs text-emerald-700">{c.tech}</td>
                    <td className="px-4 py-3 text-slate-700">{c.purpose}</td>
                    <td className="px-4 py-3 text-slate-600">{c.expiry}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 5. 调用模式 */}
      <section id="patterns" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          <span className="mr-2">🔁</span>服务调用模式
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {callPatterns.map((p) => (
            <div key={p.name} className="rounded-lg border bg-white p-5">
              <h3 className="font-semibold text-slate-900 mb-2">{p.name}</h3>
              <p className="text-sm text-slate-600 mb-3">{p.description}</p>
              <pre className="text-xs font-mono bg-slate-50 border rounded p-3 overflow-x-auto text-slate-800">
                {p.code}
              </pre>
            </div>
          ))}
        </div>
      </section>

      {/* 6. 部署架构 */}
      <section id="deploy" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          <span className="mr-2">🚀</span>部署架构
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border bg-white p-5">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              本地开发
            </div>
            <ul className="space-y-1.5">
              {deploymentComparison.dev.map((s) => (
                <li key={s} className="text-sm text-slate-700 flex items-start gap-2">
                  <span className="text-slate-400 mt-0.5">›</span>
                  <span className="font-mono text-xs">{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border bg-white p-5">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              生产环境
            </div>
            <ul className="space-y-1.5">
              {deploymentComparison.prod.map((s) => (
                <li key={s} className="text-sm text-slate-700 flex items-start gap-2">
                  <span className="text-slate-400 mt-0.5">›</span>
                  <span className="font-mono text-xs">{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 7. 技术栈 */}
      <section id="stack" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          <span className="mr-2">🛠</span>技术栈选型
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">前端</h3>
            <ul className="space-y-1.5 text-xs text-slate-700">
              <li><span className="font-mono">Next.js 14</span> · React 框架</li>
              <li><span className="font-mono">TypeScript 5</span> · 类型系统</li>
              <li><span className="font-mono">Tailwind 3</span> · CSS</li>
              <li><span className="font-mono">shadcn/ui</span> · 组件库</li>
            </ul>
          </div>
          <div className="rounded-lg border bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">后端</h3>
            <ul className="space-y-1.5 text-xs text-slate-700">
              <li><span className="font-mono">Next.js API</span> · API 服务</li>
              <li><span className="font-mono">Prisma 5</span> · ORM</li>
              <li><span className="font-mono">PostgreSQL 15</span> · DB</li>
              <li><span className="font-mono">Redis 7</span> · 缓存/队列</li>
            </ul>
          </div>
          <div className="rounded-lg border bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">AI/ML</h3>
            <ul className="space-y-1.5 text-xs text-slate-700">
              <li><span className="font-mono">LM Studio</span> · 本地模型</li>
              <li><span className="font-mono">OpenAI API</span> · 云端备用</li>
              <li><span className="font-mono">PaddleOCR</span> · OCR</li>
              <li><span className="font-mono">python-docx</span> · Word</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 8. 性能目标 */}
      <section id="targets" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          <span className="mr-2">⏱</span>性能目标
        </h2>
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">指标</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">目标</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">说明</th>
                </tr>
              </thead>
              <tbody>
                {perfTargets.map((p) => (
                  <tr key={p.metric} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{p.metric}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">
                        {p.target}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 9. 安全约束 */}
      <section id="security" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          <span className="mr-2">🔒</span>安全约束
        </h2>
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="divide-y">
            {securityConstraints.map((s) => (
              <div
                key={s.area}
                className="flex items-start gap-4 px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className="text-xs font-mono text-slate-500 uppercase tracking-wide w-20 flex-shrink-0 pt-0.5">
                  {s.area}
                </div>
                <div className="text-sm text-slate-700">{s.requirement}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 底部来源 */}
      <footer className="mt-12 pt-6 border-t text-xs text-slate-500">
        架构真相来源：
        <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded mx-1">
          product-truth/02-technical-truth/技术架构.md
        </code>
        · 与 F022 AI 服务降级联动
      </footer>
    </div>
  )
}
