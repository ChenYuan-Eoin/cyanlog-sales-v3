// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const { externalRate, auth, query, probe, ownedLegacy, ownedCollaborative, importedSuffix, recordTracking, recordCapability, requireManager, requireOperator, resolveShippingEntry, loadWorkspaceSettings, hasLegacyConfig, importLegacyConfig, loadConfiguration, saveCredentials, saveServices, enableIntercept, getProbeCredentials, recordProbe, runtimeConfig, userSettings } = vi.hoisted(() => ({ externalRate: vi.fn(), auth: vi.fn(), query: vi.fn(), probe: vi.fn(), ownedLegacy: vi.fn(), ownedCollaborative: vi.fn(), importedSuffix: vi.fn(), recordTracking: vi.fn(), recordCapability: vi.fn(), requireManager: vi.fn(), requireOperator: vi.fn(), resolveShippingEntry: vi.fn(), loadWorkspaceSettings: vi.fn(), hasLegacyConfig: vi.fn(), importLegacyConfig: vi.fn(), loadConfiguration: vi.fn(), saveCredentials: vi.fn(), saveServices: vi.fn(), enableIntercept: vi.fn(), getProbeCredentials: vi.fn(), recordProbe: vi.fn(), runtimeConfig: vi.fn(), userSettings: vi.fn() }))
vi.mock('@/lib/shipping/rate-limit', () => ({ enforceExternalTrackingRate: externalRate }))
vi.mock('@/lib/auth', () => ({ requireAuth: auth, AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/shipping/sf-client', () => ({ querySfTracking: query, querySfOrderTracking: query, probeSfConnection: probe }))
vi.mock('@/lib/shipping/store', () => ({ getOwnedShippingWaybill: ownedLegacy }))
vi.mock('@/lib/shipping/collaboration', () => ({ getOrganizationShipmentProviderSnapshot: ownedCollaborative }))
vi.mock('@/lib/shipping/legacy-configuration-scope', () => ({ canImportLegacyShippingConfiguration: async () => true }))
vi.mock('@/lib/shipping/outbound', () => ({ importedOutboundSuffix: importedSuffix }))
vi.mock('@/lib/shipping/tracking-store', () => ({ recordTrackingResult: recordTracking }))
vi.mock('@/lib/shipping/connection-authorization', async original => ({
  ...await original<typeof import('@/lib/shipping/connection-authorization')>(),
  requireShippingConnectionManager: requireManager,
  loadShippingConnectionAccess: async (userId: string) => ({
    orgId: await requireManager(userId, 'shipping:settings_view'),
    permissions: ['shipping:settings_view'],
  }),
}))
vi.mock('@/lib/shipping/operator-access', () => ({ requireShippingOperator: requireOperator }))
vi.mock('@/lib/shipping/entry-access', () => ({ resolveShippingEntry }))
vi.mock('@/lib/shipping/workspace-settings', () => ({ loadShippingWorkspaceSettings: loadWorkspaceSettings }))
vi.mock('@/lib/shipping/connections', () => ({ loadShippingConfiguration: loadConfiguration, saveCarrierCredentials: saveCredentials, saveAuthorizedServices: saveServices, enableSfInterceptAccess: enableIntercept, getConnectionProbeCredentials: getProbeCredentials, recordConnectionProbe: recordProbe, recordShippingCapability: recordCapability, hasLegacyShippingConfiguration: hasLegacyConfig, importLegacyShippingConfiguration: importLegacyConfig }))
vi.mock('@/lib/shipping/runtime-config', () => ({ getShippingRuntimeConfig: runtimeConfig, loadShippingSettings: userSettings }))
import { GET, POST as POSTSettings } from './settings/route'
import { POST } from './tracking/route'
import { AuthError } from '@/lib/auth'
import { ShippingError } from '@/lib/shipping/config'
const runtime = { orgId: 'org-1', connectionId: 'conn-1', environment: 'sandbox', partnerId: 'partner', checkWord: 'secret', billingAccountId: 'account-1', billingAccount: '123456', billingAccountTail: '3456', senderProfileId: 'sender-1', sender: { name: '发件人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试路1号' }, connectionKey: 'key', services: [{ id: 2, name: '标准服务', preference: 'standard' }], snapshot: {} }
beforeEach(() => { externalRate.mockReset().mockResolvedValue(undefined); importedSuffix.mockReset(); importedSuffix.mockResolvedValue(null); auth.mockReset(); query.mockReset(); probe.mockReset(); probe.mockResolvedValue({ connected: true, queryVerified: true, message: '只读连接通过。' }); ownedLegacy.mockReset(); ownedLegacy.mockResolvedValue(null); ownedCollaborative.mockReset(); ownedCollaborative.mockResolvedValue(null); recordTracking.mockReset(); recordTracking.mockResolvedValue({ recorded: 0 }); recordCapability.mockReset().mockResolvedValue(true); requireManager.mockReset(); requireManager.mockImplementation(async (userId: string) => { if (userId !== 'allowed') throw new ShippingError(403, '需要寄件连接管理权限。'); return 'org-1' }); requireOperator.mockReset().mockResolvedValue('org-1'); resolveShippingEntry.mockReset().mockResolvedValue(null); loadWorkspaceSettings.mockReset().mockResolvedValue({ environment: 'sandbox', canOperate: false, canManageConnections: false }); hasLegacyConfig.mockReset().mockReturnValue(false); importLegacyConfig.mockReset().mockResolvedValue({ configuration: { connections: [], billingAccounts: [], sender: null }, imported: [], needsAttention: [] }); loadConfiguration.mockReset(); loadConfiguration.mockResolvedValue({ connections: [], billingAccounts: [], sender: null }); saveCredentials.mockReset(); saveCredentials.mockResolvedValue({ connections: [], billingAccounts: [], sender: null }); saveServices.mockReset(); saveServices.mockResolvedValue({ connections: [], billingAccounts: [], sender: null }); enableIntercept.mockReset().mockResolvedValue(undefined); getProbeCredentials.mockReset(); getProbeCredentials.mockImplementation(async (_orgId: string, environment: string) => ({ id: `${environment}-connection`, partnerId: 'partner', checkWord: 'check-word' })); recordProbe.mockReset(); recordProbe.mockResolvedValue({ connections: [], billingAccounts: [], sender: null }); runtimeConfig.mockReset(); runtimeConfig.mockResolvedValue(runtime); userSettings.mockReset(); userSettings.mockResolvedValue({ defaultBillingAccountId: 'account-1' }); query.mockResolvedValue({ waybill: 'SF1234567890123', events: [], queriedAt: '2026-09-14T00:00:00Z' }) })
describe('shipping access is server enforced', () => {
  it('denies logged-out requests', async () => { auth.mockRejectedValue(new AuthError()); expect((await GET(new NextRequest('http://localhost/api/shipping/settings'))).status).toBe(401) })
  it('denies a member without operator or manager permission', async () => { auth.mockResolvedValue({ id: 'other' }); requireOperator.mockRejectedValue(new ShippingError(403, '当前账号没有自助收寄操作权限。')); expect((await GET(new NextRequest('http://localhost/api/shipping/settings'))).status).toBe(403) })
  it('ties the configuration to the current organization without disclosing provider keys or operator grants', async () => {
    auth.mockResolvedValue({ id: 'allowed' })
    const response = await GET(new NextRequest('http://localhost/api/shipping/settings'))
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(JSON.parse(body).orgId).toBe('org-1')
    expect(body).not.toContain('check-word-private')
    expect(body).not.toContain('operatorAccess')
    expect(loadConfiguration).toHaveBeenCalledWith('org-1')
  })
  it('denies connection settings for an operator without connection authority', async () => {
    auth.mockResolvedValue({ id: 'operator' })
    const response = await GET(new NextRequest('http://localhost/api/shipping/settings'))
    expect(response.status).toBe(403)
    expect(loadConfiguration).not.toHaveBeenCalled()
  })
  it.each([true, false])('returns the live connection-management flag (%s) with scoped operator settings', async canManageConnections => {
    auth.mockResolvedValue({ id: 'operator' })
    resolveShippingEntry.mockResolvedValue({ orgId: 'current-org', canOperate: true, canManageConnections })
    const response = await GET(new NextRequest('http://localhost/api/shipping/settings?workspace=1', {
      headers: { authorization: 'Bearer verified-session' },
    }))
    expect(response.status).toBe(200)
    expect(resolveShippingEntry).toHaveBeenCalledWith({ id: 'operator' }, 'verified-session')
    expect(loadWorkspaceSettings).toHaveBeenCalledWith('current-org')
    expect(await response.json()).toEqual({ settings: { environment: 'sandbox', canOperate: true, canManageConnections } })
    expect(loadConfiguration).not.toHaveBeenCalled()
  })

  it('keeps the workspace settings loader out of the connection-manager-only path', async () => {
    auth.mockResolvedValue({ id: 'allowed' })
    resolveShippingEntry.mockResolvedValue({ orgId: 'current-org', canOperate: false, canManageConnections: true })
    const response = await GET(new NextRequest('http://localhost/api/shipping/settings?workspace=1'))
    expect(response.status).toBe(403)
    expect(loadWorkspaceSettings).not.toHaveBeenCalled()
    expect(loadConfiguration).not.toHaveBeenCalled()
  })

  it('stores machine credentials through the manager route and does not echo them', async () => { auth.mockResolvedValue({ id: 'allowed' }); const response = await POSTSettings(new NextRequest('http://localhost/api/shipping/settings', { method: 'POST', body: JSON.stringify({ action: 'save_connection', environment: 'sandbox', partnerId: 'partner-1234', checkWord: 'secret-check-word' }) })); expect(response.status).toBe(200); expect(saveCredentials).toHaveBeenCalledWith('org-1', 'allowed', { environment: 'sandbox', partnerId: 'partner-1234', checkWord: 'secret-check-word' }); expect(await response.text()).not.toContain('secret-check-word') })
  it('requires the billing grant when a connection save also changes allowed services', async () => {
    auth.mockResolvedValue({ id: 'allowed' })
    requireManager.mockImplementation(async (_userId: string, permissions: string[]) => {
      if (permissions.includes('shipping:billing_write')) throw new ShippingError(403, '缺少月结和服务权限。')
      return 'org-1'
    })
    const request = (services?: unknown) => new NextRequest('http://localhost/api/shipping/settings', {
      method: 'POST',
      body: JSON.stringify({
        action: 'save_connection', environment: 'sandbox', partnerId: 'partner-1234', checkWord: 'secret-check-word',
        ...(services ? { services } : {}),
      }),
    })
    expect((await POSTSettings(request([{ id: 2, name: '顺丰标快', preference: 'standard' }]))).status).toBe(403)
    expect(saveCredentials).not.toHaveBeenCalled()
    expect((await POSTSettings(request())).status).toBe(200)
    expect(saveCredentials).toHaveBeenCalledOnce()
  })
  it('updates authorized services without requiring machine credentials in the request', async () => { auth.mockResolvedValue({ id: 'allowed' }); const services = [{ id: 2, name: '顺丰标快', preference: 'standard' }]; const response = await POSTSettings(new NextRequest('http://localhost/api/shipping/settings', { method: 'POST', body: JSON.stringify({ action: 'save_authorized_services', environment: 'sandbox', services }) })); expect(response.status).toBe(200); expect(saveServices).toHaveBeenCalledWith('org-1', 'allowed', { environment: 'sandbox', services }); expect(await response.text()).not.toContain('secret-check-word') })
  it('updates authorized services without sending machine credentials again', async () => { auth.mockResolvedValue({ id: 'allowed' }); const services = [{ id: 2, name: '顺丰标快', preference: 'standard' }]; const response = await POSTSettings(new NextRequest('http://localhost/api/shipping/settings', { method: 'POST', body: JSON.stringify({ action: 'save_authorized_services', environment: 'sandbox', services }) })); expect(response.status).toBe(200); expect(saveServices).toHaveBeenCalledWith('org-1', 'allowed', { environment: 'sandbox', services }); expect(await response.text()).not.toContain('check-word') })
  it('enables in-transit forwarding and return only through the explicit capability action', async () => {
    auth.mockResolvedValue({ id: 'allowed' })
    const response = await POSTSettings(new NextRequest('http://localhost/api/shipping/settings', {
      method: 'POST',
      body: JSON.stringify({ action: 'enable_sf_intercept_access', environment: 'production', confirmation: 'EXP_RECE_WANTED_INTERCEPT' }),
    }))
    expect(response.status).toBe(200)
    expect(enableIntercept).toHaveBeenCalledWith('org-1', 'allowed', { environment: 'production', confirmation: 'EXP_RECE_WANTED_INTERCEPT' })
    expect(loadConfiguration).toHaveBeenCalledWith('org-1')
  })
  it('imports old server configuration without echoing any environment value', async () => { auth.mockResolvedValue({ id: 'allowed' }); importLegacyConfig.mockResolvedValue({ configuration: { connections: [], billingAccounts: [], sender: null }, imported: ['顺丰机器连接（服务端加密）'], needsAttention: [] }); const response = await POSTSettings(new NextRequest('http://localhost/api/shipping/settings', { method: 'POST', body: JSON.stringify({ action: 'import_legacy_configuration', environment: 'production' }) })); expect(response.status).toBe(200); expect(importLegacyConfig).toHaveBeenCalledWith('org-1', 'allowed', 'production'); expect(await response.text()).not.toContain('secret') })
  it('rejects the retired operator save action without changing grants', async () => { auth.mockResolvedValue({ id: 'allowed' }); const userIds = ['11111111-1111-4111-8111-111111111111']; const response = await POSTSettings(new NextRequest('http://localhost/api/shipping/settings', { method: 'POST', body: JSON.stringify({ action: 'save_operator_access', userIds }) })); expect(response.status).toBe(410); expect(loadConfiguration).not.toHaveBeenCalled() })
  it('rejects the retired operator migration action without changing grants', async () => { auth.mockResolvedValue({ id: 'allowed' }); const response = await POSTSettings(new NextRequest('http://localhost/api/shipping/settings', { method: 'POST', body: JSON.stringify({ action: 'import_legacy_operator_access' }) })); expect(response.status).toBe(410); expect(loadConfiguration).not.toHaveBeenCalled() })
  it('tests the saved sandbox connection without taking credentials from the browser', async () => { auth.mockResolvedValue({ id: 'allowed' }); const response = await POSTSettings(new NextRequest('http://localhost/api/shipping/settings', { method: 'POST', body: JSON.stringify({ action: 'test_sandbox_connection' }) })); expect(response.status).toBe(200); expect(getProbeCredentials).toHaveBeenCalledWith('org-1', 'sandbox'); expect(probe).toHaveBeenCalledWith('sandbox', 'partner', 'check-word'); expect(recordProbe).toHaveBeenCalledWith('org-1', 'sandbox-connection', { connected: true, queryVerified: true, message: '只读连接通过。' }); expect(await response.text()).not.toContain('check-word') })
  it('tests a saved Production connection with read-only OAuth2 and never creates an order', async () => { auth.mockResolvedValue({ id: 'allowed' }); const response = await POSTSettings(new NextRequest('http://localhost/api/shipping/settings', { method: 'POST', body: JSON.stringify({ action: 'test_production_connection' }) })); expect(response.status).toBe(200); expect(getProbeCredentials).toHaveBeenCalledWith('org-1', 'production'); expect(probe).toHaveBeenCalledWith('production', 'partner', 'check-word'); expect(recordProbe).toHaveBeenCalledWith('org-1', 'production-connection', { connected: true, queryVerified: true, message: '只读连接通过。' }); expect(await response.text()).not.toContain('check-word') })
  it('rejects cross-origin side effects before calling SF', async () => { auth.mockResolvedValue({ id: 'allowed' }); const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ waybill: 'SF1234567890123' }) })); expect(r.status).toBe(403); expect(query).not.toHaveBeenCalled() })
  it('rejects malformed or extra fields', async () => { auth.mockResolvedValue({ id: 'allowed' }); const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123', created_by: 'other' }) })); expect(r.status).toBe(400); expect(query).not.toHaveBeenCalled() })
  it('queries an owned waybill using its saved connection snapshot and records verified capability', async () => { auth.mockResolvedValue({ id: 'allowed' }); runtimeConfig.mockResolvedValue({ ...runtime, environment: 'production' }); query.mockResolvedValue({ waybill: 'SF1234567890123', events: [{ time: '2026-10-12 10:30', description: '已揽收' }], queriedAt: '2026-10-12T04:00:00Z' }); ownedLegacy.mockResolvedValue({ org_id: 'org-1', carrier_connection_id: 'conn-1', billing_account_id: 'account-1' }); const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) })); expect(r.status).toBe(200); expect(runtimeConfig).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', connectionId: 'conn-1', billingAccountId: 'account-1', allowHistorical: true })); expect(query).toHaveBeenCalledWith('SF1234567890123', undefined, expect.objectContaining({ environment: 'production' })); expect(recordCapability).toHaveBeenCalledWith('org-1', 'conn-1', 'tracking'); expect(userSettings).not.toHaveBeenCalled() })
  it('rejects an unknown saved carrier without falling back to SF', async () => {
    auth.mockResolvedValue({ id: 'allowed' })
    ownedCollaborative.mockResolvedValue({ org_id: 'org-1', provider_key: 'uninstalled', carrier_connection_id: 'conn-1', billing_account_id: 'account-1' })
    const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) }))
    expect(r.status).toBe(400)
    expect(runtimeConfig).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled()
  })
  it('tracks a nonmonthly order using its saved connection without requiring an account', async () => {
    auth.mockResolvedValue({ id: 'allowed' })
    ownedCollaborative.mockResolvedValue({ org_id: 'org-1', provider_key: 'sf', provider_order_id: 'stored-order', carrier_connection_id: 'conn-1', billing_account_id: null, connection_environment: 'sandbox' })
    runtimeConfig.mockResolvedValue({ ...runtime, billingAccountId: null, billingAccount: '' })
    const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) }))
    expect(r.status).toBe(200)
    expect(runtimeConfig).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'conn-1', billingAccountId: null, requireOrderCapability: false }))
    expect(userSettings).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith('stored-order', 'SF1234567890123', expect.objectContaining({ billingAccountId: null }))
  })
  it('rejects a changed historical connection environment before fetching or recording routes', async () => {
    auth.mockResolvedValue({ id: 'allowed' })
    runtimeConfig.mockResolvedValue({ ...runtime, environment: 'production' })
    ownedCollaborative.mockResolvedValue({ org_id: 'org-1', provider_key: 'sf', connection_environment: 'sandbox', carrier_connection_id: 'conn-1', billing_account_id: 'account-1' })
    const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) }))
    expect(r.status).toBe(409)
    expect(query).not.toHaveBeenCalled(); expect(recordTracking).not.toHaveBeenCalled()
  })
  it('records normalized events for platform waybills', async () => { runtimeConfig.mockResolvedValue({ ...runtime, environment: 'production' }); auth.mockResolvedValue({ id: 'allowed' }); ownedLegacy.mockResolvedValue({ org_id: 'org-1', carrier_connection_id: 'conn-1', billing_account_id: 'account-1' }); await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) })); expect(recordTracking).toHaveBeenCalledWith('org-1', expect.objectContaining({ waybill: 'SF1234567890123' }), 'sf') })
  it('requires a suffix before asking the provider to verify an external waybill', async () => {
    auth.mockResolvedValue({ id: 'allowed' })
    const response = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) }))
    expect(response.status).toBe(422); expect(query).not.toHaveBeenCalled()
  })
  it('uses the production provider to verify an external suffix, without creating local ownership', async () => {
    auth.mockResolvedValue({ id: 'allowed' }); runtimeConfig.mockResolvedValue({ ...runtime, environment: 'production' })
    query.mockResolvedValue({ waybill: 'SF1234567890123', events: [{ time: '2026-10-12 10:30', description: '已揽收' }], queriedAt: '2026-10-12T04:00:00Z' })
    const response = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123', phoneSuffix: '1410' }) }))
    expect(response.status).toBe(200)
    expect(externalRate).toHaveBeenCalledWith('org-1', 'allowed')
    expect(query).toHaveBeenCalledWith('SF1234567890123', '1410', expect.objectContaining({ environment: 'production' }))
    expect(runtimeConfig.mock.calls[0][0]).not.toHaveProperty('billingAccountId')
    expect(recordTracking).not.toHaveBeenCalled()
  })
  it.each(['empty', 'rejected', 'sandbox', 'limited'])('does not grant an external query on %s verification', async mode => {
    auth.mockResolvedValue({ id: 'allowed' }); runtimeConfig.mockResolvedValue({ ...runtime, environment: mode === 'sandbox' ? 'sandbox' : 'production' })
    if (mode === 'rejected') query.mockRejectedValue(new ShippingError(422, '号码不匹配'))
    else query.mockResolvedValue({ waybill: 'SF1234567890123', events: [], queriedAt: '2026-10-12T04:00:00Z' })
    if (mode === 'limited') externalRate.mockRejectedValue(new ShippingError(429, '查询过于频繁'))
    const response = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123', phoneSuffix: '0000' }) }))
    expect(response.status).toBe(mode === 'sandbox' ? 409 : mode === 'limited' ? 429 : 422)
    expect(recordTracking).not.toHaveBeenCalled(); expect(recordCapability).not.toHaveBeenCalled()
    if (mode === 'sandbox' || mode === 'limited') expect(query).not.toHaveBeenCalled()
  })

  it('looks up an imported waybill under the caller and uses its verified phone suffix', async () => { auth.mockResolvedValue({ id: 'allowed' }); importedSuffix.mockResolvedValue('1410'); const response = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123', phoneSuffix: '0000' }) })); expect(response.status).toBe(200); expect(importedSuffix).toHaveBeenCalledWith('allowed', 'SF1234567890123'); expect(userSettings).toHaveBeenCalledWith('org-1'); expect(query).toHaveBeenCalledWith('SF1234567890123', '1410', runtime) })
  it('blocks a former organization snapshot before loading its credentials or calling SF', async () => {
    auth.mockResolvedValue({ id: 'allowed' })
    ownedLegacy.mockResolvedValue({ org_id: 'org-foreign', carrier_connection_id: 'foreign-conn', billing_account_id: 'foreign-account' })
    const response = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) }))
    expect(response.status).toBe(403)
    expect(runtimeConfig).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled(); expect(recordTracking).not.toHaveBeenCalled()
  })
  it('allows organization operators to track a same-organization anonymous intake after confirmation', async () => {
    runtimeConfig.mockResolvedValue({ ...runtime, environment: 'production' })
    auth.mockResolvedValue({ id: 'allowed' })
    ownedCollaborative.mockResolvedValue({ org_id: 'org-1', carrier_connection_id: 'conn-1', billing_account_id: 'account-1' })
    const response = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) }))
    expect(response.status).toBe(200)
    expect(ownedCollaborative).toHaveBeenCalledWith('org-1', 'SF1234567890123')
    expect(ownedLegacy).toHaveBeenCalledWith('allowed', 'org-1', 'SF1234567890123')
    expect(recordTracking).toHaveBeenCalledWith('org-1', expect.objectContaining({ waybill: 'SF1234567890123' }), 'sf')
  })
  it('returns the saved shipment status together with the route, without an extra ledger fetch', async () => {
    runtimeConfig.mockResolvedValue({ ...runtime, environment: 'production' })
    auth.mockResolvedValue({ id: 'allowed' })
    ownedCollaborative.mockResolvedValue({ org_id: 'org-1', carrier_connection_id: 'conn-1', billing_account_id: 'account-1' })
    recordTracking.mockResolvedValue({ recorded: 1, shipmentStatus: 'in_transit' })
    const response = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ waybill: 'SF1234567890123', shipmentStatus: 'in_transit' })
    expect(query).toHaveBeenCalledTimes(1)
    expect(recordTracking).toHaveBeenCalledTimes(1)
  })

  it('labels SF sandbox mock routes and never uses them to update persisted shipment status', async () => {
    auth.mockResolvedValue({ id: 'allowed' })
    ownedCollaborative.mockResolvedValue({ org_id: 'org-1', carrier_connection_id: 'conn-1', billing_account_id: 'account-1' })
    query.mockResolvedValue({ waybill: 'SF1234567890123', queriedAt: '2026-09-27T00:00:00Z', events: [{ time: '2026-09-27 08:00:00', description: '已签收', location: '模拟地点', status: 'delivered' }] })
    const response = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) }))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.source).toBe('sandbox_mock')
    expect(result).not.toHaveProperty('shipmentStatus')
    expect(recordTracking).not.toHaveBeenCalled()
  })

})
