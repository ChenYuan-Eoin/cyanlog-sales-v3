// REQ: WP10 阶段1/3（口径一致）
import { describe, expect, it } from 'vitest'
import { calculateMaintenance, calculateVersionSwitch, calculateHaUplift } from './upgrade-maintenance'

describe('calculateMaintenance（维保金额）', () => {
  it('一次性授权 10 万，次年起 20%/年 → 2 万', () => {
    const r = calculateMaintenance({ softwareTotal: 100000 })
    expect(r.annualAmount).toBe(20000)
    expect(r.effectiveRate).toBe(0.2)
    expect(r.startMonth).toBe(1)
  })

  it('已含首年维保 → 从第 13 个月起算', () => {
    const r = calculateMaintenance({ softwareTotal: 100000, includedMonths: 12 })
    expect(r.startMonth).toBe(13)
  })

  it('三套环境 → 费率 20% + 2×2% = 24%', () => {
    const r = calculateMaintenance({ softwareTotal: 100000, envCount: 3 })
    expect(r.effectiveRate).toBe(0.24)
    expect(r.annualAmount).toBe(24000)
  })
})

describe('calculateVersionSwitch（转版本残值抵扣）', () => {
  it('同税率：旧 10 万用 6/12 个月，残值 5 万抵扣新方案 12 万 → 应付 7 万', () => {
    const r = calculateVersionSwitch({ oldPaidTotal: 100000, oldTotalMonths: 12, oldUsedMonths: 6, oldTaxRate: 0.06, newTotal: 120000, newTaxRate: 0.06 })
    expect(r.residual).toBe(50000)
    expect(r.payableAfterCredit).toBe(70000)
    expect(r.creditNote).toContain('同税率')
  })

  it('不同税率：6%→13% 按不含税残值换算抵扣', () => {
    const r = calculateVersionSwitch({ oldPaidTotal: 106000, oldTotalMonths: 12, oldUsedMonths: 12, oldTaxRate: 0.06, newTotal: 100000, newTaxRate: 0.13 })
    expect(r.residual).toBe(0)
    expect(r.payableAfterCredit).toBe(100000)
  })

  it('已用超期 → 残值不为负（封顶 0 抵扣）', () => {
    const r = calculateVersionSwitch({ oldPaidTotal: 10000, oldTotalMonths: 12, oldUsedMonths: 24, oldTaxRate: 0.06, newTotal: 5000, newTaxRate: 0.06 })
    expect(r.residual).toBe(0)
    expect(r.payableAfterCredit).toBe(5000)
  })
})

describe('calculateHaUplift（高可用加价）', () => {
  it('新购 +20%', () => {
    const r = calculateHaUplift({ softwareTotal: 100000, isUpgrade: false })
    expect(r.uplift).toBe(20000)
    expect(r.rate).toBe(0.2)
  })

  it('老客户升级按全部订单 20%', () => {
    const r = calculateHaUplift({ softwareTotal: 250000, isUpgrade: true })
    expect(r.uplift).toBe(50000)
  })
})
