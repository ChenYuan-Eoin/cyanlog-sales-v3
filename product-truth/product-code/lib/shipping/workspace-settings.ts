import { loadIntakeSettings } from './intake-settings'
import { ShippingError } from './config'
import { loadShippingSettings } from './runtime-config'
import { loadDefaultShippingSender } from './sender-profile'
import { emptyContact, type ShippingSettings } from './types'

// Only the operator workspace degrades on configuration read failures. The
// confirmation APIs still resolve and validate actual configuration fail-closed.
async function loadWorkspaceBase(orgId: string): Promise<ShippingSettings> {
  if (!orgId?.trim()) throw new ShippingError(403, '缺少组织范围。')
  try { return await loadShippingSettings(orgId) }
  catch (error) {
    if (!(error instanceof ShippingError) || error.status !== 503) throw error
    let sender = emptyContact(), defaultsWarning: string | undefined
    try { sender = await loadDefaultShippingSender(orgId) }
    catch (senderError) {
      if (!(senderError instanceof ShippingError) || senderError.status !== 503) throw senderError
      defaultsWarning = '默认寄件资料暂时无法读取，依赖默认资料的提报请稍后重试。'
    }
    const warning = '寄件配置暂时无法读取。仍可查看工单；寄件资料可用时可继续提报，正式下单暂不可用。'
    return {
      // No connection is selected and no request may use this display default.
      environment: 'sandbox', ready: false, canSubmit: false,
      reason: warning, configurationWarning: warning, defaultsWarning,
      sender, services: [], monthlyTail: '', carrierConnections: [], billingAccounts: [],
    }
  }
}

export async function loadShippingWorkspaceSettings(orgId: string): Promise<ShippingSettings> {
  const settings = await loadWorkspaceBase(orgId)
  try { return { ...settings, intakeRules: await loadIntakeSettings(orgId) } }
  catch { return { ...settings, intakeRulesWarning: '提报字段规则暂时无法读取，请刷新后再提交。现有工单仍可查看。' } }
}
