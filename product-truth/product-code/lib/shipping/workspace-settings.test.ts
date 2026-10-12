// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShippingError } from './config'
import { emptyContact } from './types'
const m = vi.hoisted(() => ({ rules: vi.fn(), settings: vi.fn(), sender: vi.fn() }))
vi.mock('./intake-settings', () => ({ loadIntakeSettings: m.rules }))
vi.mock('./runtime-config', () => ({ loadShippingSettings: m.settings }))
vi.mock('./sender-profile', () => ({ loadDefaultShippingSender: m.sender }))
import { loadShippingWorkspaceSettings } from './workspace-settings'

beforeEach(() => { vi.resetAllMocks(); m.sender.mockResolvedValue({ ...emptyContact(), name: '测试前台' }) })
describe('workspace availability is separate from carrier readiness', () => {
  it('preserves healthy settings without another sender query', async () => {
    const settings = { ready: true, canSubmit: true, environment: 'production' }
    m.settings.mockResolvedValue(settings)
    expect(await loadShippingWorkspaceSettings('org-1')).toMatchObject(settings)
    expect(m.sender).not.toHaveBeenCalled()
  })
  it('retains the same organization sender but disables fulfillment when settings are unavailable', async () => {
    m.settings.mockRejectedValue(new ShippingError(503, 'backend unavailable'))
    const result = await loadShippingWorkspaceSettings('org-1')
    expect(m.sender).toHaveBeenCalledWith('org-1')
    expect(result).toMatchObject({ ready: false, canSubmit: false, sender: { name: '测试前台' }, services: [], carrierConnections: [], billingAccounts: [] })
    expect(result.configurationWarning).toContain('正式下单暂不可用')
    expect(result.connectionId).toBeUndefined()
  })
  it('distinguishes unavailable sender data from an unconfigured sender', async () => {
    m.settings.mockRejectedValue(new ShippingError(503, 'unavailable'))
    m.sender.mockRejectedValue(new ShippingError(503, 'unavailable'))
    const result = await loadShippingWorkspaceSettings('org-1')
    expect(result.sender).toEqual(emptyContact())
    expect(result.defaultsWarning).toContain('暂时无法读取')
    expect(result.canSubmit).toBe(false)
  })
  it('never turns authorization or unexpected errors into a usable workspace', async () => {
    for (const error of [new ShippingError(403, 'denied'), new Error('unexpected')]) {
      m.settings.mockRejectedValue(error)
      await expect(loadShippingWorkspaceSettings('org-1')).rejects.toBe(error)
    }
    expect(m.sender).not.toHaveBeenCalled()
    await expect(loadShippingWorkspaceSettings('')).rejects.toMatchObject({ status: 403 })
  })
})
