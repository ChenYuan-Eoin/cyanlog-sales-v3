// AI 降级配置和监控展示页
// 静态展示 + 路由阈值 + 降级历史（mock）

import { determineStrategy, determineStartLevel } from '@/lib/ai-fallback/orchestrator'

export const metadata = {
  title: 'AI 降级策略 - Cyanlog Sales',
  description: 'AI 服务 3 级降级链：本地模型 → 云端模型 → 规则引擎',
}

const levelCards = [
  {
    level: 1,
    name: '本地模型',
    source: 'LM Studio',
    description: 'Ollama 兼容 API，localhost:1234',
    triggers: ['页数 ≤ 15：整体送入', '15 < 页数 ≤ 40：分段送入'],
    timeout: '45 秒',
    color: 'emerald',
  },
  {
    level: 2,
    name: '云端模型',
    source: '中转站 (yiyongai)',
    description: 'OpenAI 兼容 API，claude-sonnet-4-6',
    triggers: ['页数 > 40：强制云端', 'Level 1 超时/失败 → 自动降级', '用户手动 forceCloud'],
    timeout: '45 秒',
    color: 'blue',
  },
  {
    level: 3,
    name: '规则引擎',
    source: '结构化规则集',
    description: '5 条内置规则（R001-R005），永远可用',
    triggers: ['Level 1 + Level 2 都失败', '返回降级提示'],
    timeout: '< 1 秒',
    color: 'slate',
  },
]

const colorMap: Record<string, { ring: string; bg: string; text: string; badge: string }> = {
  emerald: { ring: 'ring-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-700', badge: 'bg-emerald-100' },
  blue: { ring: 'ring-blue-200', bg: 'bg-blue-50', text: 'text-blue-700', badge: 'bg-blue-100' },
  slate: { ring: 'ring-slate-200', bg: 'bg-slate-50', text: 'text-slate-700', badge: 'bg-slate-100' },
}

// 路由阈值测试
const testCases = [
  { pageCount: 5, forceCloud: false, expectedLevel: 1, strategy: 'local-full' },
  { pageCount: 15, forceCloud: false, expectedLevel: 1, strategy: 'local-full' },
  { pageCount: 16, forceCloud: false, expectedLevel: 1, strategy: 'local-segment' },
  { pageCount: 40, forceCloud: false, expectedLevel: 1, strategy: 'local-segment' },
  { pageCount: 41, forceCloud: false, expectedLevel: 2, strategy: 'cloud' },
  { pageCount: 10, forceCloud: true, expectedLevel: 2, strategy: 'cloud' },
]

// Mock 降级历史（v1 静态）
const recentFallbacks = [
  { time: '14:32:01', level: 2, source: 'cloud', reason: 'Level 1 timeout (45s)' },
  { time: '13:15:22', level: 3, source: 'rules', reason: 'Level 1 failed + Level 2 rate limited' },
  { time: '11:48:55', level: 1, source: 'local', reason: null },
  { time: '10:22:10', level: 2, source: 'cloud', reason: 'Level 1 OOM' },
  { time: '09:05:33', level: 1, source: 'local', reason: null },
]

export default function AiFallbackPage() {
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-2">AI 服务降级</h1>
        <p className="text-slate-600 max-w-2xl">
          当任何一级 AI 服务不可用时，自动降级到下一级。3 级降级链：本地模型 → 云端模型 → 规则引擎。
        </p>
      </header>

      {/* 降级链展示 */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">3 级降级链</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {levelCards.map((card, idx) => {
            const c = colorMap[card.color]
            return (
              <div key={card.level} className="relative">
                <div className={`rounded-lg border bg-white p-5 ${c.ring} ring-1`}>
                  <div className="flex items-baseline justify-between mb-3">
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                        Level {card.level}
                      </div>
                      <h3 className={`text-lg font-semibold ${c.text}`}>{card.name}</h3>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${c.badge} ${c.text}`}>
                      {card.source}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mb-3">{card.description}</p>
                  <div className="space-y-1.5 mb-3">
                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                      触发条件
                    </div>
                    {card.triggers.map((t, i) => (
                      <div key={i} className="text-sm text-slate-700 flex items-start gap-2">
                        <span className="text-slate-400 mt-0.5">›</span>
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-slate-500">
                    超时阈值：<span className="font-mono">{card.timeout}</span>
                  </div>
                </div>
                {idx < levelCards.length - 1 && (
                  <div className="hidden lg:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10 w-4 h-4 items-center justify-center text-slate-400 text-2xl" aria-hidden>
                    →
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* 路由阈值测试表 */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">路由阈值</h2>
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">页数</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">forceCloud</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">起始 Level</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">处理策略</th>
                </tr>
              </thead>
              <tbody>
                {testCases.map((tc, idx) => {
                  const actualLevel = determineStartLevel({
                    text: '',
                    pageCount: tc.pageCount,
                    task: 'semantic',
                    forceCloud: tc.forceCloud,
                  })
                  const strategy = determineStrategy(tc.pageCount)
                  return (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-mono text-slate-700">{tc.pageCount}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            tc.forceCloud
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {tc.forceCloud ? 'true' : 'false'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">
                          Level {actualLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-blue-700">
                        {strategy}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 降级历史（v1 静态 mock） */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-900">近期降级记录</h2>
          <span className="text-xs text-slate-500">v1 静态示例 · Phase 2 接入实时</span>
        </div>
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">时间</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">实际 Level</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">来源</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">降级原因</th>
                </tr>
              </thead>
              <tbody>
                {recentFallbacks.map((r, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.time}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-mono px-2 py-0.5 rounded ${
                          r.level === 1
                            ? 'bg-emerald-50 text-emerald-700'
                            : r.level === 2
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        Level {r.level}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.source}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.reason || <span className="text-emerald-600">— 正常</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* API 端点 */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">API 端点</h2>
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-mono bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
              POST
            </span>
            <code className="text-sm font-mono text-slate-900">/api/ai/analyze</code>
          </div>
          <pre className="text-xs font-mono bg-slate-50 border rounded p-3 overflow-x-auto text-slate-800">
{`Request:
{
  "text": "合同正文...",
  "pageCount": 10,
  "task": "semantic" | "extract" | "classify",
  "forceCloud": false
}

Response:
{
  "level": 1 | 2 | 3,
  "source": "local" | "cloud" | "rules",
  "result": { ... },
  "duration": 1234,  // ms
  "fallbackReason": "Level 1 timeout",
  "attempts": [ ... ]
}`}
          </pre>
        </div>
      </section>

      <footer className="mt-12 pt-6 border-t text-xs text-slate-500">
        降级策略来源：
        <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded mx-1">
          product-truth/02-technical-truth/技术架构.md#4
        </code>
        · 完整实现：<code className="font-mono">lib/ai-fallback/</code>
      </footer>
    </div>
  )
}
