// REQ: WP10 阶段1/3（口径一致）
// PURPOSE: 维保金额 + 转版本残值抵扣（纯函数，业务参数传入，不写死）
// 口径（来自售卖规则）：
//  - 维保：一次性授权次年起收全单 20%/年；多套环境每套 +2%（超过 1 套部分）
//  - 转版本：旧方案未消耗价值抵扣新方案；税率对应抵扣（如 6% 抵 6%）
//  - 高可用：新购 +20%；老客户升级按全部订单 +20%（由调用方传入费率）

export interface MaintenanceInput {
  /** 软件累计费用（维保基数 = 软件销售价合计，不含服务） */
  softwareTotal: number
  /** 维保费率（MAINT_RATE，默认 0.2） */
  rate?: number
  /** 环境套数（超过 1 套时每套递增 MAINT_MULTI_ENV_INC） */
  envCount?: number
  /** 多套环境递增（MAINT_MULTI_ENV_INC，默认 0.02） */
  envIncrement?: number
  /** 已含维保月份（新签当单若已含首年维保则从次年计） */
  includedMonths?: number
}

export interface MaintenanceResult {
  /** 年度维保金额 */
  annualAmount: number
  /** 生效费率（含多环境递增） */
  effectiveRate: number
  /** 起始月份（一次性授权次年起；默认第 13 个月） */
  startMonth: number
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** 维保金额 = 软件累计费用 × 费率 ×（1 + (套数-1) × 环境递增） */
export function calculateMaintenance(input: MaintenanceInput): MaintenanceResult {
  const rate = input.rate ?? 0.2
  const envCount = Math.max(1, Math.floor(input.envCount ?? 1))
  const envIncrement = input.envIncrement ?? 0.02
  // 口径：多套环境每套 +2%（加法，非乘法）——如 20% + (3-1)×2% = 24%
  const effectiveRate = round2((rate + Math.max(0, envCount - 1) * envIncrement) * 10000) / 10000
  const annualAmount = round2(input.softwareTotal * effectiveRate)
  const startMonth = input.includedMonths && input.includedMonths >= 12 ? 13 : (input.includedMonths ?? 0) + 1
  return { annualAmount, effectiveRate, startMonth }
}

// ---------- 转版本残值抵扣 ----------

export interface VersionSwitchInput {
  /** 旧方案已支付总额（含税） */
  oldPaidTotal: number
  /** 旧方案总期限（月） */
  oldTotalMonths: number
  /** 旧方案已使用（月） */
  oldUsedMonths: number
  /** 旧方案税率（0-1，用于税率对应抵扣） */
  oldTaxRate: number
  /** 新方案含税总额 */
  newTotal: number
  /** 新方案税率（0-1） */
  newTaxRate: number
}

export interface VersionSwitchResult {
  /** 旧方案残值（未消耗价值，按已用比例线性折算） */
  residual: number
  /** 抵扣后新方案应付（含税） */
  payableAfterCredit: number
  /** 税率差异调整：仅同税率抵扣；不同税率时按不含税残值抵扣 */
  creditNote: string
}

/**
 * 转版本残值抵扣：
 *  - 残值 = 旧已付 × (1 - 已用/总期限)
 *  - 税率对应：旧税率 == 新税率 → 含税残值直接抵扣；否则按不含税残值抵扣（避免税差倒挂）
 */
export function calculateVersionSwitch(input: VersionSwitchInput): VersionSwitchResult {
  if (input.oldTotalMonths <= 0 || input.oldUsedMonths < 0) {
    throw new Error('旧方案期限必须大于 0，已用月份不能为负')
  }
  const usedRatio = Math.min(1, input.oldUsedMonths / input.oldTotalMonths)
  const residualGross = round2(input.oldPaidTotal * (1 - usedRatio))
  const sameTax = Math.abs(input.oldTaxRate - input.newTaxRate) < 0.0001
  const credit = sameTax
    ? residualGross
    : round2(residualGross / (1 + input.oldTaxRate) * (1 + input.newTaxRate))
  const payableAfterCredit = round2(Math.max(0, input.newTotal - credit))
  return {
    residual: residualGross,
    payableAfterCredit,
    creditNote: sameTax
      ? `同税率抵扣：残值 ${residualGross} 直接抵扣`
      : `税率 ${(input.oldTaxRate * 100).toFixed(0)}%→${(input.newTaxRate * 100).toFixed(0)}%：按不含税残值换算抵扣 ${credit}`,
  }
}

// ---------- 高可用加价 ----------

export interface HaUpliftInput {
  /** 软件累计费用 */
  softwareTotal: number
  /** 新购加价（HA_NEW_UPLIFT，默认 0.2） */
  newUpliftRate?: number
  /** 老客户升级费率（HA_UPGRADE_RATE，默认 0.2） */
  upgradeRate?: number
  /** 是否老客户升级（true=按全部订单费率；false=新购） */
  isUpgrade?: boolean
}

export function calculateHaUplift(input: HaUpliftInput): { uplift: number; rate: number } {
  const rate = input.isUpgrade ? (input.upgradeRate ?? 0.2) : (input.newUpliftRate ?? 0.2)
  return { uplift: round2(input.softwareTotal * rate), rate }
}
