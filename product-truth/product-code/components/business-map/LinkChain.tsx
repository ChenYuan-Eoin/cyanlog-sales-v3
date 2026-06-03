import type { BusinessLink } from '@/lib/business-map/data'

export function LinkChain({ link }: { link: BusinessLink }) {
  const accentBar = link.accentColor === 'blue' ? 'bg-blue-500' : 'bg-purple-500'
  const accentText = link.accentColor === 'blue' ? 'text-blue-900' : 'text-purple-900'

  return (
    <section className="rounded-lg border bg-white p-6">
      <div className="flex items-baseline gap-3 mb-2">
        <h3 className={`text-lg font-semibold ${accentText}`}>{link.name}</h3>
        <span className="text-xs text-slate-500">{link.steps.length} 步</span>
      </div>
      <p className="text-sm text-slate-600 mb-6">{link.description}</p>

      <div className="overflow-x-auto -mx-2 px-2 pb-2">
        <ol className="flex items-stretch gap-2 min-w-max">
          {link.steps.map((step, idx) => (
            <li key={idx} className="flex items-stretch gap-2 flex-shrink-0">
              <div className="flex flex-col items-center min-w-[140px] max-w-[160px]">
                <div
                  className={`
                    w-10 h-10 rounded-full ${accentBar} text-white
                    flex items-center justify-center font-semibold text-sm mb-2
                  `}
                >
                  {idx + 1}
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center w-full">
                  <div className="text-sm font-medium text-slate-900">{step.label}</div>
                  <div className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {step.description}
                  </div>
                </div>
              </div>
              {idx < link.steps.length - 1 && (
                <div className="flex items-center text-slate-300 self-start mt-3 text-2xl" aria-hidden>
                  →
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
