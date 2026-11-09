// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderApl } from './build-apl.mjs'

function profile(objectName = 'ContractObj', taskName = '寄件通过') {
  const config = JSON.parse(readFileSync(new URL('./fxiaoke-approval-intake.example.json', import.meta.url), 'utf8'))
  config.enterpriseId = 'dev-tenant'
  config.endpoint.clientId = 'dev-client'
  config.workflow.objectApiName = objectName
  config.rootObject.objectApiName = objectName
  config.workflow.stages[0].taskName = taskName
  config.workflow.stages[0].stageId = 'shipping-approved'
  config.shipmentDetailObject.objectApiName = 'ShipmentDetailObj'
  config.shipmentDetailObject.parentRecordId.path = 'parent__c'
  return config
}

describe('reusable APL artifact generation', () => {
  it('reuses identical executable core for different workflows and field mappings', () => {
    const first = renderApl(profile())
    const other = profile('QuoteObj', "补件 '确认' $节点")
    other.shipmentDetailObject.shipment.recipient.name.path = 'receiver__c'
    const second = renderApl(other)
    expect(first.coreSha256).toEqual(second.coreSha256)
    expect(first.source).not.toEqual(second.source)
    expect(second.source).toContain('receiver__c')
    expect(second.source).toContain("\\'确认\\'")
    expect(second.source).toContain('$节点')
  })

  it('keeps preflight as the default and allows an explicitly selected create mode', () => {
    expect(renderApl(profile()).mode).toBe('preflight')
    expect(renderApl({ ...profile(), mode: 'create' }).mode).toBe('create')
    expect(() => renderApl({ ...profile(), mode: 'anything' })).toThrow('mode')
  })

  it('rejects real secrets, unfilled configuration, and unsupported mapping shapes', () => {
    const config = profile()
    config.endpoint.clientSecret = 'test-only'.repeat(8)
    expect(() => renderApl(config)).toThrow('密钥占位符')
    const unfilled = profile()
    unfilled.rootObject.customerId.path = '__CONFIGURE_ACCOUNT__'
    expect(() => renderApl(unfilled)).toThrow('尚未填写')
    const ambiguous = profile()
    ambiguous.workflow.stages.push({ ...ambiguous.workflow.stages[0], taskName: 'another', stageId: 'another' })
    expect(() => renderApl(ambiguous)).toThrow('每个节点')
  })

  it('separates production and development origins without accepting URL tricks', () => {
    const config = profile()
    config.environment = 'development'
    config.endpoint.baseUrl = 'https://candidate.vercel.app'
    expect(renderApl(config).environment).toBe('development')
    for (const url of ['https://sales.cyanlog.icu', 'http://candidate.vercel.app', 'https://candidate.vercel.app.evil.test', 'https://user@candidate.vercel.app', 'https://candidate.vercel.app/path']) {
      config.endpoint.baseUrl = url
      expect(() => renderApl(config)).toThrow()
    }
    config.environment = 'production'
    config.endpoint.baseUrl = 'https://candidate.vercel.app'
    expect(() => renderApl(config)).toThrow('正式 ICU')
  })
})
