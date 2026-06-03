import type { StateMachine } from '@/lib/business-map/data'

const terminalStates = new Set(['REJECTED', 'CONFIRMED', 'COMPLETED', 'FAILED', 'TIMEOUT'])

function stateColor(state: string): string {
  if (state === 'DRAFT' || state === 'PENDING' || state === 'PARSING' || state === 'ANALYZING') {
    return 'bg-slate-100 text-slate-800 border-slate-300'
  }
  if (state === 'APPROVED' || state === 'SENT' || state === 'CONFIRMED' || state === 'COMPLETED') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-300'
  }
  if (terminalStates.has(state)) {
    return 'bg-rose-50 text-rose-800 border-rose-300'
  }
  if (state === 'PENDING_APPROVAL' || state === 'TRANSFERRED' || state === 'TIMEOUT') {
    return 'bg-amber-50 text-amber-800 border-amber-300'
  }
  return 'bg-blue-50 text-blue-800 border-blue-300'
}

export function StateMachineView({ sm }: { sm: StateMachine }) {
  return (
    <section className="rounded-lg border bg-white p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-1">{sm.name}</h3>
      <p className="text-sm text-slate-600 mb-5">{sm.description}</p>

      {/* 状态节点 */}
      <div className="flex flex-wrap gap-2 mb-5">
        {sm.states.map((state) => (
          <span
            key={state}
            className={`
              inline-block text-xs font-mono px-2.5 py-1 rounded border
              ${stateColor(state)}
            `}
          >
            {state}
          </span>
        ))}
      </div>

      {/* 转换列表 */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          状态转换
        </h4>
        {sm.transitions.map((t, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 text-sm text-slate-700"
            aria-label={`${t.from} 转换到 ${t.to}${t.label ? '：' + t.label : ''}`}
          >
            <code className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded">
              {t.from}
            </code>
            <span className="text-slate-400">→</span>
            <code className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded">
              {t.to}
            </code>
            {t.label && (
              <span className="text-xs text-slate-500 ml-1">（{t.label}）</span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
