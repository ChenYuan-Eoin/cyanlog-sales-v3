import { ModuleCard } from '@/components/business-map/ModuleCard'
import { LinkChain } from '@/components/business-map/LinkChain'
import { StateMachineView } from '@/components/business-map/StateMachineView'
import { modules, links, stateMachines, entryRules } from '@/lib/business-map/data'

export const metadata = {
  title: '业务地图 - ONES Sales',
  description: '销售系统全景图：核心模块、业务链路、状态机',
}

export default function BusinessMapPage() {
  const currentModules = modules.filter((m) => m.phase === 'current')
  const phase2Modules = modules.filter((m) => m.phase === 'phase2')

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* 页头 */}
      <header className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-2">业务地图</h1>
        <p className="text-slate-600 max-w-2xl">
          以合同审核为核心的智能销售支撑平台全景视图。包含 6 个核心模块、2 条主业务链路、3 个核心对象状态机。
        </p>
      </header>

      {/* 顶部锚点导航 */}
      <nav
        className="mb-8 flex flex-wrap gap-2 text-sm"
        aria-label="业务地图内导航"
      >
        <a href="#modules" className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700">
          核心模块
        </a>
        <a href="#links" className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700">
          业务链路
        </a>
        <a href="#states" className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700">
          状态机
        </a>
        <a href="#rules" className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700">
          入口规则
        </a>
      </nav>

      {/* Section 1: 核心模块 */}
      <section id="modules" className="mb-10 scroll-mt-4">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-900">核心模块</h2>
          <span className="text-sm text-slate-500">
            {currentModules.length} 个当前 · {phase2Modules.length} 个 Phase 2
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-3">
          {currentModules.map((m) => (
            <ModuleCard key={m.id} module={m} />
          ))}
        </div>

        {phase2Modules.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {phase2Modules.map((m) => (
              <ModuleCard key={m.id} module={m} />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: 业务链路 */}
      <section id="links" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">核心业务链路</h2>
        <div className="space-y-6">
          {links.map((link) => (
            <LinkChain key={link.id} link={link} />
          ))}
        </div>
      </section>

      {/* Section 3: 状态机 */}
      <section id="states" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">核心对象状态机</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {stateMachines.map((sm) => (
            <StateMachineView key={sm.id} sm={sm} />
          ))}
        </div>
      </section>

      {/* Section 4: 入口规则 */}
      <section id="rules" className="mb-10 scroll-mt-4">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">入口与链路总规则</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {entryRules.map((rule, idx) => (
            <div
              key={idx}
              className="rounded-lg border bg-white p-5 hover:border-slate-300 transition-colors"
            >
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                规则 {idx + 1}
              </div>
              <h3 className="font-semibold text-slate-900 mb-2">{rule.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{rule.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 底部来源说明 */}
      <footer className="mt-12 pt-6 border-t text-xs text-slate-500">
        业务真相来源：
        <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded mx-1">
          product-truth/01-business-truth/业务地图.md
        </code>
        · 本页仅展示，详情见真相文档
      </footer>
    </div>
  )
}
