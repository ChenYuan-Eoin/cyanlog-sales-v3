// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDefinitiveShippingRejection, ShippingWorkbenchRequestError, shippingWorkbenchRequest } from './workbench-client'

afterEach(() => vi.unstubAllGlobals())

async function requestFailure(response: Response | Error) {
  vi.stubGlobal('fetch', response instanceof Error ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response))
  return shippingWorkbenchRequest('/api/shipping/owner/orders', { method: 'POST', body: '{}' }).then(() => { throw new Error('Expected request to fail') }, error => error as unknown)
}

describe('shipping submission error certainty', () => {
  it('carries only the public error, HTTP status and recognized request stage', async () => {
    const error = await requestFailure(Response.json({ error: '顺丰明确拒绝受理', requestStage: 'provider_rejected', debug: 'example-debug-info' }, { status: 422 }))
    expect(error).toBeInstanceOf(ShippingWorkbenchRequestError)
    expect(error).toMatchObject({ message: '顺丰明确拒绝受理', status: 422, requestStage: 'provider_rejected' })
    expect(error).not.toHaveProperty('debug')
    expect(isDefinitiveShippingRejection(error)).toBe(true)
  })

  it('recognizes explicit pre-submission rejections without treating server or conflict errors as safe to resubmit', async () => {
    for (const status of [400, 401, 403, 413, 422]) {
      const error = await requestFailure(Response.json({ error: '前置请求被拒绝' }, { status }))
      expect(isDefinitiveShippingRejection(error)).toBe(true)
    }
    for (const status of [409, 500, 503]) {
      const error = await requestFailure(Response.json({ error: '无法确认是否已下单' }, { status }))
      expect(isDefinitiveShippingRejection(error)).toBe(false)
    }
  })

  it('keeps network failures and malformed responses uncertain even when their HTTP status normally means validation', async () => {
    const network = await requestFailure(new TypeError('example network failure'))
    expect(network).toMatchObject({ requestStage: 'client_network_error', status: undefined })
    expect(isDefinitiveShippingRejection(network)).toBe(false)
    expect(isDefinitiveShippingRejection(new TypeError('example network failure'))).toBe(false)
    for (const response of [new Response('not-json', { status: 400 }), Response.json(null), Response.json([]), Response.json({ error: '错误', requestStage: 'unrecognized' }, { status: 400 })]) {
      const error = await requestFailure(response)
      expect(error).toMatchObject({ requestStage: 'client_invalid_response' })
      expect(isDefinitiveShippingRejection(error)).toBe(false)
    }
  })

  it('does not treat uncertain provider stages as definitive rejection', async () => {
    for (const requestStage of ['provider_unreachable', 'provider_http_error', 'provider_invalid_response']) {
      const error = await requestFailure(Response.json({ error: '承运商结果未确认', requestStage }, { status: 422 }))
      expect(isDefinitiveShippingRejection(error)).toBe(false)
    }
    const validation = await requestFailure(Response.json({ error: '资料校验失败', requestStage: 'validation' }, { status: 400 }))
    expect(isDefinitiveShippingRejection(validation)).toBe(true)
  })
})
