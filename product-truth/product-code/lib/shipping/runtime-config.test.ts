import { describe, expect, it } from 'vitest'
import { productionOrderCapabilityAllowsAttempt, selectAuthorizedShippingService } from './runtime-config'

const services = [
  { id: 2, name: '标准标快', preference: 'standard' as const },
  { id: 1, name: '加急特快', preference: 'urgent' as const }
]

describe('authorized carrier service selection', () => {
  it('maps provider-neutral sales preferences to the configured service IDs', () => {
    expect(selectAuthorizedShippingService(services, 'standard')).toMatchObject({ id: 2, name: '标准标快' })
    expect(selectAuthorizedShippingService(services, 'urgent')).toMatchObject({ id: 1, name: '加急特快' })
  })

  it('honors an explicit authorized user selection', () => {
    expect(selectAuthorizedShippingService(services, 'standard', 1)).toMatchObject({ id: 1 })
  })

  it('fails closed when the account has no service mapped to the requested preference', () => {
    expect(() => selectAuthorizedShippingService([services[0]], 'urgent')).toThrow('未配置与该寄件偏好匹配的服务')
  })

  it('rejects a service ID that is not authorized for the selected account', () => {
    expect(() => selectAuthorizedShippingService(services, 'standard', 99)).toThrow('所选服务未在当前月结账号中授权')
  })
})

describe('Production first-order capability gate', () => {
  it('allows an operator-confirmed first attempt while capability is untested', () => {
    expect(productionOrderCapabilityAllowsAttempt('not_tested')).toBe(true)
  })

  it('allows subsequent attempts after a successful live order', () => {
    expect(productionOrderCapabilityAllowsAttempt('verified')).toBe(true)
  })

  it('blocks attempts only when the capability is explicitly unavailable', () => {
    expect(productionOrderCapabilityAllowsAttempt('unavailable')).toBe(false)
  })
})
