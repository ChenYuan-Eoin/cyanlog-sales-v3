// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FxiaokeError } from '../contracts'
const mocks = vi.hoisted(() => ({ factory: vi.fn(), relay: vi.fn() }))
vi.mock('./server', () => ({ transportForOrganization: mocks.factory }))
import { directoryTransportForOrganization } from './directory-transport'
import { inspectObjectMetadata, previewDirectory } from '../client'

const credentials = { appId: 'app_fixture', appSecret: 'secret', permanentCode: 'permanent', expectedEa: 'company', apiUserId: 'employee' }
const url = () => `https://open.fxiaoke.com/oauth2.0/token?thirdTraceId=${randomUUID()}`
const init = () => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: credentials.appId, appSecret: credentials.appSecret, permanentCode: credentials.permanentCode, grantType: 'app_secret' }) })
const ok = () => Response.json({ errorCode: 0, appId: credentials.appId, ea: credentials.expectedEa, openUserId: 'FSCID_fixture', accessToken: 'token' })
const ipDenied = () => Response.json({ errorCode: 12345, errorMessage: 'IP 不在白名单' })
const offline = () => new FxiaokeError('EGRESS_UNAVAILABLE', 'relay offline', 503)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.factory.mockReturnValue(mocks.relay)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('reads the whole directory directly while the optional host is off, without consulting its configuration or queue', async () => {
  mocks.factory.mockImplementation(() => { throw offline() })
  const direct = vi.fn().mockResolvedValueOnce(ok())
    .mockResolvedValueOnce(Response.json({ errorCode: 0, data: { total: 1, dataList: [{ _id: 'd1', name: '部门', parent_id: [], status: '0' }] } }))
    .mockResolvedValueOnce(Response.json({ errorCode: 0, data: { total: 1, dataList: [{ _id: 'p1', user_id: 'u1', name: '员工', main_department: ['d1'], vice_departments: [], status: '0', is_pause_login: false }] } }))
  vi.stubGlobal('fetch', direct)
  const directory = await previewDirectory(credentials, directoryTransportForOrganization('org-1'))
  expect(directory).toMatchObject({ complete: true, applied: false })
  expect(directory.employees[0]).toMatchObject({ id: 'u1', primaryDepartmentId: 'd1' })
  expect(direct).toHaveBeenCalledTimes(3)
  expect(mocks.factory).not.toHaveBeenCalled()
})

it('leaves object metadata direct while the optional host is off', async () => {
  mocks.factory.mockImplementation(() => { throw offline() })
  const direct = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(Response.json({
    errorCode: 0,
    data: { objects: [{ describeApiName: 'ApprovalObj', describeDisplayName: '寄件审批', defineType: 'custom', isActive: true }] },
  }))
  vi.stubGlobal('fetch', direct)
  const metadata = await inspectObjectMetadata(credentials, { operation: 'list' }, directoryTransportForOrganization('org-1'))
  expect(metadata).toMatchObject({ operation: 'list', objects: [{ apiName: 'ApprovalObj' }] })
  expect(direct).toHaveBeenCalledTimes(2)
  expect(mocks.factory).not.toHaveBeenCalled()
})

it.each(['network', 'http', 'ip'])('reports a direct %s failure without using the cloud relay', async kind => {
  const direct = vi.fn()
  if (kind === 'network') direct.mockRejectedValue(new TypeError('fetch failed'))
  else direct.mockResolvedValue(kind === 'http' ? new Response('unavailable', { status: 503 }) : ipDenied())
  vi.stubGlobal('fetch', direct); mocks.relay.mockResolvedValue(ok())
  const result = directoryTransportForOrganization('org-1')(url(), init())
  if (kind === 'network') await expect(result).rejects.toMatchObject({ code: 'DIRECTORY_SOURCE_UNAVAILABLE' })
  else if (kind === 'http') expect((await result).status).toBe(503)
  else expect(await (await result).json()).toEqual({ errorCode: 12345, errorMessage: 'IP 不在白名单' })
  expect(mocks.factory).not.toHaveBeenCalled()
  expect(mocks.relay).not.toHaveBeenCalled()
})

it.each([
  () => Response.json({ errorCode: 401, errorMessage: 'invalid app secret' }),
  () => Response.json({ errorCode: 403, errorMessage: 'read permission denied' }),
  () => new Response('rate limited', { status: 429 }),
  () => new Response('invalid JSON'),
])('does not retry credential, permission, throttling or malformed responses through the relay', async reply => {
  const source = reply()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(source.clone()))
  const result = await directoryTransportForOrganization('org-1')(url(), init())
  expect(result.status).toBe(source.status)
  expect(await result.text()).toBe(await source.text())
  expect(mocks.relay).not.toHaveBeenCalled()
})

it('fails explicitly when direct reads are unavailable, never returns an empty successful directory', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  mocks.relay.mockRejectedValue(offline())
  await expect(previewDirectory(credentials, directoryTransportForOrganization('org-1')))
    .rejects.toMatchObject({ code: 'DIRECTORY_SOURCE_UNAVAILABLE', status: 503 })
  expect(mocks.factory).not.toHaveBeenCalled()
  expect(mocks.relay).not.toHaveBeenCalled()
})

it('bounds the direct attempt to six seconds without trying the cloud relay', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    expect(ms).toBe(6000)
    return AbortSignal.abort(new DOMException('timed out', 'TimeoutError'))
  })
  vi.stubGlobal('fetch', vi.fn((_url, options) => { options.signal.throwIfAborted() }))
  mocks.relay.mockResolvedValue(ok())
  await expect(directoryTransportForOrganization('org-1')(url(), init()))
    .rejects.toMatchObject({ code: 'DIRECTORY_SOURCE_UNAVAILABLE' })
  expect(mocks.factory).not.toHaveBeenCalled()
  expect(mocks.relay).not.toHaveBeenCalled()
  timeout.mockRestore()
})

it('never sends cancelled reads to another route', async () => {
  const controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn(() => { controller.abort(); throw new TypeError('cancelled') }))
  await expect(directoryTransportForOrganization('org-1')(url(), { ...init(), signal: controller.signal })).rejects.toThrow()
  expect(mocks.factory).not.toHaveBeenCalled()
})

it('excludes OAuth code exchange and arbitrary hosts before any network call', async () => {
  const direct = vi.fn(); vi.stubGlobal('fetch', direct)
  const send = directoryTransportForOrganization('org-1')
  await expect(send('https://example.test/oauth2.0/token', init())).rejects.toMatchObject({ code: 'EGRESS_REQUEST_DENIED' })
  await expect(send(url(), { ...init(), body: JSON.stringify({ appId: credentials.appId, appSecret: credentials.appSecret, grantType: 'authorization_code', code: 'code', redirectUrl: 'https://sales.cyanlog.icu/api/auth/fxiaoke/callback' }) }))
    .rejects.toMatchObject({ code: 'EGRESS_REQUEST_DENIED' })
  expect(direct).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled()
})
