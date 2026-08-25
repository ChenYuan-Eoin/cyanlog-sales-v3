// WP10 硬指标：100 行 SKU 预览刷新 <500ms（机制层性能基准）
// 前端 useMemo 每次依赖变化重算一次 calculateQuote；本测试模拟 100 行修改一行重算
import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { calculateQuote } from './quote-calculator'
import type { QuoteLineInput } from './quote-builder'
import type { CumulativeTier } from './cumulative'

const TIERS: CumulativeTier[] = [
  { qty_from: 1, qty_to: 10, unit_price: 1500, list_price: 15000 },
  { qty_from: 11, qty_to: 100, unit_price: 1400, list_price: 29100 },
  { qty_from: 101, qty_to: null, unit_price: 1300, list_price: 41100 },
]

function makeLine(i: number): QuoteLineInput {
  return {
    productId: `p${i}`,
    productCode: i % 2 === 0 ? 'PROJECT' : 'WIKI',
    category: 'BASE',
    follows: [],
    versionCode: 'ENT_V6',
    deployment: 'PUBLIC_CLOUD',
    authMode: 'SUB_YEAR',
    termMonths: 12,
    quantity: 10 + (i % 5),
    tiers: TIERS,
  }
}

describe('WP10 性能硬指标：100 行 SKU 预览刷新 <500ms', () => {
  it('100 行改一行重算，p95 < 500ms', () => {
    const lines = Array.from({ length: 100 }, (_, i) => makeLine(i))
    const base = { discountRate: 0.1, softwareTaxRate: 0.13, serviceTaxRate: 0.06, currency: 'CNY' as const }

    // warmup
    for (let i = 0; i < 3; i += 1) calculateQuote({ ...base, lines })

    const runs = 20
    const samples: number[] = []
    for (let i = 0; i < runs; i += 1) {
      const modified = lines.map((l, idx) => (idx === i % 100 ? { ...l, quantity: 20 + (i % 7) } : l))
      const t0 = performance.now()
      const r = calculateQuote({ ...base, lines: modified })
      const t1 = performance.now()
      if (!r.ok) {
        throw new Error(`calc failed issues=${JSON.stringify(r.issues?.slice(0, 3))} noPrice=${r.noPrice}`)
      }
      samples.push(t1 - t0)
    }
    samples.sort((a, b) => a - b)
    const p95 = samples[Math.floor(samples.length * 0.95)]
    const avg = samples.reduce((s, x) => s + x, 0) / samples.length
    // eslint-disable-next-line no-console
    console.log(`[PERF] 100 lines × ${runs} runs avg=${avg.toFixed(2)}ms p95=${p95.toFixed(2)}ms`)
    expect(p95).toBeLessThan(500)
  })
})
